#!/usr/bin/env bash
set -u

host="${1:?host obrigatorio}"
ssh_user="${2:?usuario ssh obrigatorio}"
port="${3:-2222}"
connect_timeout="${4:-10}"
api_user="${5:-admin}"
apply_flag="${6:-0}"
rotate_flag="${7:-0}"
allowed_interfaces="${8:-wan,lo0}"

IFS= read -r SSHPASS || {
  echo "nao foi possivel ler a senha pelo stdin"
  exit 98
}
export SSHPASS
api_password_b64="$(printf "%s" "$SSHPASS" | base64 | tr -d "\n")"

ssh_args=(
  -p "$port"
  -o BatchMode=no
  -o PreferredAuthentications=password,keyboard-interactive
  -o PubkeyAuthentication=no
  -o KbdInteractiveAuthentication=yes
  -o ChallengeResponseAuthentication=yes
  -o NumberOfPasswordPrompts=1
  -o ConnectTimeout="$connect_timeout"
  -o StrictHostKeyChecking=accept-new
  -o LogLevel=ERROR
)

remote_script='
set -u

api_user="${FLEET_API_USER:-admin}"
api_password_b64="${FLEET_API_PASSWORD_B64:?senha api ausente}"
api_password="$(printf "%s" "$api_password_b64" | base64 -d)"
apply_flag="${FLEET_APPLY_FLAG:-0}"
rotate_flag="${FLEET_ROTATE_FLAG:-0}"
allowed_interfaces="${FLEET_ALLOWED_INTERFACES:-wan,lo0}"
echo "allowed_interfaces=$allowed_interfaces"

version="$(cat /etc/version 2>/dev/null | tr -d "\r\n")"
if [ -z "$version" ]; then
  echo "nao consegui detectar /etc/version"
  exit 11
fi
echo "version=$version"

if command -v pfsense-restapi >/dev/null 2>&1; then
  family="restapi_v2"
elif command -v pfsense-api >/dev/null 2>&1; then
  family="api_v1"
else
  echo "api_package=ausente"
  exit 12
fi
echo "family=$family"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl=ausente"
  exit 13
fi

discover_base_url() {
  php -r '"'"'
    require_once("config.inc");
    global $config;
    $webgui = $config["system"]["webgui"] ?? [];
    $proto = $webgui["protocol"] ?? "https";
    $port = $webgui["port"] ?? "";
    if ($port === "") {
      $port = ($proto === "http") ? "80" : "443";
    }
    $pairs = [
      [$proto, $port],
      ["https", "443"],
      ["http", "80"],
      ["https", $port],
      ["http", $port],
    ];
    $seen = [];
    foreach ($pairs as $pair) {
      [$p, $po] = $pair;
      $key = "$p:$po";
      if (isset($seen[$key])) { continue; }
      $seen[$key] = true;
      echo "$p://127.0.0.1:$po\n";
      echo "$p://localhost:$po\n";
    }
  '"'"' 2>/dev/null
}

base_url=""
for candidate_url in $(discover_base_url); do
  http_code="$(curl -ksS -o /dev/null -w "%{http_code}" --connect-timeout 2 "$candidate_url/" 2>/dev/null || true)"
  case "$http_code" in
    000) ;;
    *)
      base_url="$candidate_url"
      break
      ;;
  esac
done

if [ -z "$base_url" ]; then
  echo "webgui=nao_encontrado_localmente"
  exit 14
fi
echo "base_url=$base_url"

parse_json_field() {
  field="$1"
  php -r '"'"'
    $field = $argv[1];
    $json = stream_get_contents(STDIN);
    $data = json_decode($json, true);
    if (!is_array($data)) { exit(2); }
    $value = $data["data"][$field] ?? $data[$field] ?? "";
    if (is_array($value)) { echo json_encode($value); }
    else { echo $value; }
  '"'"' "$field"
}

request() {
  method="$1"
  url="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -ksS -w "\nHTTP_CODE=%{http_code}\n" -u "$api_user:$api_password" \
      -X "$method" -H "Content-Type: application/json" -d "$body" "$url"
  else
    curl -ksS -w "\nHTTP_CODE=%{http_code}\n" -u "$api_user:$api_password" \
      -X "$method" "$url"
  fi
}

require_success() {
  response="$1"
  code="$(printf "%s" "$response" | awk -F= "/^HTTP_CODE=/{print \$2}" | tail -n 1)"
  if [ "$code" != "200" ]; then
    echo "api_auth=falhou"
    printf "%s\n" "$response"
    exit 20
  fi
}

if [ "$family" = "restapi_v2" ]; then
  echo "auth_type=x-api-key"
  if [ "$apply_flag" != "1" ]; then
    response="$(request GET "$base_url/api/v2/system/version")"
    code="$(printf "%s" "$response" | awk -F= "/^HTTP_CODE=/{print \$2}" | tail -n 1)"
    if [ "$code" = "200" ]; then
      echo "dry_run=basic_auth_ok; criaria chave Fleet Guardian"
    elif [ "$code" = "401" ] || [ "$code" = "403" ]; then
      echo "dry_run=basic_auth_indisponivel; apply_usara_ssh_php_para_criar_chave"
    else
      require_success "$response"
    fi
    exit 0
  fi

  key_output="$(FLEET_ALLOWED_INTERFACES="$allowed_interfaces" php <<PHP
<?php
require_once("config.inc");
require_once("util.inc");
global \$config;

\$username = getenv("FLEET_API_USER") ?: "admin";
\$allowed_interfaces = getenv("FLEET_ALLOWED_INTERFACES") ?: "wan,lo0";
\$key = bin2hex(random_bytes(32));
\$hash = hash("sha512", \$key);
\$changed = false;

if (!isset(\$config["installedpackages"]["package"]) || !is_array(\$config["installedpackages"]["package"])) {
    fwrite(STDERR, "installed packages config not found\n");
    exit(1);
}

foreach (\$config["installedpackages"]["package"] as &\$pkg) {
    \$name = \$pkg["name"] ?? "";
    \$internal = \$pkg["internal_name"] ?? "";
    if (\$name === "RESTAPI" || \$internal === "restapi") {
        if (!isset(\$pkg["conf"]) || !is_array(\$pkg["conf"])) {
            \$pkg["conf"] = [];
        }
        \$pkg["conf"]["enabled"] = "enabled";
        \$pkg["conf"]["read_only"] = "disabled";
        \$pkg["conf"]["keep_backup"] = "enabled";
        \$pkg["conf"]["login_protection"] = "enabled";
        \$pkg["conf"]["log_successful_auth"] = "disabled";
        \$pkg["conf"]["log_level"] = \$pkg["conf"]["log_level"] ?? "LOG_WARNING";
        \$pkg["conf"]["hateoas"] = "disabled";
        \$pkg["conf"]["expose_sensitive_fields"] = "disabled";
        \$pkg["conf"]["represent_interfaces_as"] = "id";
        \$pkg["conf"]["allowed_interfaces"] = \$allowed_interfaces;

        \$methods = \$pkg["conf"]["auth_methods"] ?? [];
        if (!is_array(\$methods)) {
            \$methods = preg_split("/[,\s]+/", (string)\$methods, -1, PREG_SPLIT_NO_EMPTY);
        }
        foreach (["BasicAuth", "KeyAuth"] as \$method) {
            if (!in_array(\$method, \$methods, true)) {
                \$methods[] = \$method;
            }
        }
        \$pkg["conf"]["auth_methods"] = implode(",", \$methods);

        if (!isset(\$pkg["conf"]["keys"]) || !is_array(\$pkg["conf"]["keys"])) {
            \$pkg["conf"]["keys"] = [];
        }
        if (!isset(\$pkg["conf"]["keys"]["key"]) || !is_array(\$pkg["conf"]["keys"]["key"])) {
            \$pkg["conf"]["keys"]["key"] = [];
        }
        if (getenv("FLEET_ROTATE_FLAG") !== "1") {
            foreach (\$pkg["conf"]["keys"]["key"] as \$existing_key) {
                if ((\$existing_key["descr"] ?? "") === "Fleet Guardian") {
                    fwrite(STDERR, "fleet guardian key already exists; use Rotate to create a new one\n");
                    exit(2);
                }
            }
        }
        \$pkg["conf"]["keys"]["key"][] = [
            "descr" => "Fleet Guardian",
            "username" => \$username,
            "hash_algo" => "sha512",
            "length_bytes" => "32",
            "hash" => \$hash,
        ];
        \$changed = true;
        break;
    }
}

if (!\$changed) {
    fwrite(STDERR, "RESTAPI package config not found\n");
    exit(1);
}

write_config("Fleet Guardian REST API key");
echo \$key;
PHP
)"
  key_exit="$?"
  if [ "$key_exit" -eq 2 ]; then
    echo "key_status=ja_existe; use -Rotate para criar nova chave"
    echo "configured=settings_only"
    exit 0
  fi
  if [ "$key_exit" -ne 0 ] || [ -z "$key_output" ]; then
    echo "key_generation=falhou_via_ssh_php"
    exit 21
  fi
  api_key="$(printf "%s" "$key_output" | tail -n 1 | tr -d "\r\n")"

  validate_code="$(curl -LksS -o /dev/null -w "%{http_code}" -H "X-API-Key: $api_key" "$base_url/api/v2/system/version")"
  if [ "$validate_code" != "200" ]; then
    echo "key_validation=falhou HTTP_CODE=$validate_code"
    exit 22
  fi

  echo "credential_id="
  echo "credential_secret=$api_key"
  echo "configured=ok"
  exit 0
fi

if [ "$family" = "api_v1" ]; then
  echo "auth_type=client-token"
  if [ "$apply_flag" != "1" ]; then
    response="$(request GET "$base_url/api/v1/system/version")"
    require_success "$response"
    echo "dry_run=validaria authmode token e geraria client-id/client-token"
    exit 0
  fi

  api_body='\''{"authmode":"token","keyhash":"sha256","keybytes":32}'\''
  response="$(request PUT "$base_url/api/v1/system/api" "$api_body")"
  if ! printf "%s" "$response" | grep -q "^HTTP_CODE=200"; then
    echo "api_settings_endpoint=falhou; tentando ajuste direto no config.xml"
    FLEET_ALLOWED_INTERFACES="$allowed_interfaces" php <<'"'"'PHP'"'"'
<?php
require_once("config.inc");
require_once("util.inc");
global $config;
$allowed_interfaces = getenv("FLEET_ALLOWED_INTERFACES") ?: "wan,lo0";
$changed = false;
if (isset($config["installedpackages"]["package"])) {
    foreach ($config["installedpackages"]["package"] as &$pkg) {
        if (($pkg["name"] ?? "") === "API" || ($pkg["internal_name"] ?? "") === "api") {
            if (!isset($pkg["conf"]) || !is_array($pkg["conf"])) {
                $pkg["conf"] = [];
            }
            $pkg["conf"]["enable"] = "";
            $pkg["conf"]["persist"] = "";
            $pkg["conf"]["allowed_interfaces"] = $allowed_interfaces;
            $pkg["conf"]["authmode"] = "token";
            $pkg["conf"]["keyhash"] = "sha256";
            $pkg["conf"]["keybytes"] = "32";
            $pkg["conf"]["enable_login_protection"] = "";
            $changed = true;
            break;
        }
    }
}
if (!$changed) {
    fwrite(STDERR, "api package config not found\n");
    exit(1);
}
write_config("Fleet Guardian API token auth");
PHP
    if [ "$?" -ne 0 ]; then
      echo "api_settings=falhou"
      exit 23
    fi
    /etc/rc.restart_webgui >/dev/null 2>&1 || true
  fi

  response="$(request POST "$base_url/api/v1/access_token")"
  json_body="$(printf "%s" "$response" | sed "/^HTTP_CODE=/d")"
  client_id="$(printf "%s" "$json_body" | parse_json_field client-id)"
  client_token="$(printf "%s" "$json_body" | parse_json_field client-token)"
  if ! printf "%s" "$response" | grep -q "^HTTP_CODE=200" || [ -z "$client_id" ] || [ -z "$client_token" ]; then
    token_output="$(FLEET_API_USER="$api_user" php <<'PHP'
<?php
require_once("api/framework/APITools.inc");
$username = getenv("FLEET_API_USER") ?: "admin";
$api = APITools\get_api_config();
if (!is_array($api) || !isset($api[0]) || !isset($api[1]) || !is_array($api[1])) {
    fwrite(STDERR, "api_config_not_found\n");
    exit(1);
}
$pkg_index = $api[0];
$api_config = $api[1];
$api_config["authmode"] = "token";
$api_config["keyhash"] = "sha256";
$api_config["keybytes"] = "32";
$api_config["keys"] = is_array($api_config["keys"] ?? null) ? $api_config["keys"] : ["key" => []];
$api_config["keys"]["key"] = is_array($api_config["keys"]["key"] ?? null) ? $api_config["keys"]["key"] : [];
config_set_path("installedpackages/package/{$pkg_index}/conf", $api_config);
$token = APITools\generate_token($username);
echo "client_id=" . bin2hex($username) . PHP_EOL;
echo "client_token=" . $token . PHP_EOL;
PHP
)"
    if [ "$?" -ne 0 ]; then
      echo "token_generation=falhou"
      printf "%s\n" "$response"
      exit 24
    fi
    client_id="$(printf "%s\n" "$token_output" | awk -F= '/^client_id=/{print $2}' | tail -n 1)"
    client_token="$(printf "%s\n" "$token_output" | awk -F= '/^client_token=/{print $2}' | tail -n 1)"
    echo "token_generation=php_fallback"
  fi
  if [ -z "$client_id" ] || [ -z "$client_token" ]; then
    echo "token_generation=falhou"
    printf "%s\n" "$response"
    exit 24
  fi

  validate_code="$(curl -LksS -o /dev/null -w "%{http_code}" -H "Authorization: $client_id $client_token" "$base_url/api/v1/system/version")"
  if [ "$validate_code" != "200" ]; then
    echo "token_validation=falhou HTTP_CODE=$validate_code"
    exit 25
  fi

  echo "credential_id=$client_id"
  echo "credential_secret=$client_token"
  echo "configured=ok"
  exit 0
fi
'

timeout "$((connect_timeout + 60))" \
  sshpass -e ssh "${ssh_args[@]}" "$ssh_user@$host" \
  "FLEET_API_USER='$api_user' FLEET_APPLY_FLAG='$apply_flag' FLEET_ROTATE_FLAG='$rotate_flag' FLEET_ALLOWED_INTERFACES='$allowed_interfaces' FLEET_API_PASSWORD_B64='$api_password_b64' sh -s" \
  <<< "$remote_script"

exit $?
