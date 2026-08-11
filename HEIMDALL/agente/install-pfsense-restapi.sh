#!/usr/bin/env bash
set -u

host="${1:?host obrigatorio}"
user="${2:?usuario obrigatorio}"
port="${3:-2222}"
connect_timeout="${4:-10}"
release_override="${5:-}"
if [ "$release_override" = "__AUTO__" ]; then
  release_override=""
fi
install_flag="${6:-0}"
update_if_installed="${7:-0}"
package_base_url="${8:-}"

IFS= read -r SSHPASS || {
  echo "nao foi possivel ler a senha pelo stdin"
  exit 98
}
export SSHPASS

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

release_override="${RESTAPI_RELEASE_OVERRIDE:-}"
if [ "$release_override" = "__AUTO__" ]; then
  release_override=""
fi
install_flag="${RESTAPI_INSTALL_FLAG:-0}"
update_if_installed="${RESTAPI_UPDATE_IF_INSTALLED:-0}"
package_base_url="${RESTAPI_PACKAGE_BASE_URL:-}"
repo_url="https://github.com/pfrest/pfSense-pkg-RESTAPI/releases/download"

version="$(cat /etc/version 2>/dev/null | tr -d "\r\n")"
if [ -z "$version" ]; then
  echo "nao consegui detectar /etc/version"
  exit 11
fi

case "$version" in
  2.5.*)
    package_family="api_v1"
    version_dir="2.5"
    default_release_tag="v1.5.4"
    package_name="pfSense-2.5-pkg-API.txz"
    install_cmd="env ASSUME_ALWAYS_YES=yes IGNORE_OSVERSION=yes pkg-static add"
    ;;
  2.6.0*)
    package_family="api_v1"
    version_dir="2.6"
    default_release_tag="v1.5.4"
    package_name="pfSense-2.6-pkg-API.txz"
    install_cmd="env ASSUME_ALWAYS_YES=yes IGNORE_OSVERSION=yes pkg-static add"
    ;;
  2.7.0*|2.7.1*)
    package_family="api_v1"
    version_dir="2.7"
    default_release_tag="v1.9.0"
    package_name="pfSense-2.7-pkg-API.pkg"
    install_cmd="pkg-static -C /dev/null add"
    ;;
  2.7.2*)
    package_family="restapi_v2"
    version_dir="2.7"
    default_release_tag="v2.4.3"
    package_name="pfSense-2.7.2-pkg-RESTAPI.pkg"
    install_cmd="pkg-static -C /dev/null add"
    ;;
  2.8.0*)
    package_family="restapi_v2"
    version_dir="2.8"
    default_release_tag="v2.7.7"
    package_name="pfSense-2.8.0-pkg-RESTAPI.pkg"
    install_cmd="pkg-static add"
    ;;
  2.8.1*)
    package_family="restapi_v2"
    version_dir="2.8"
    default_release_tag="v2.10.0"
    package_name="pfSense-2.8.1-pkg-RESTAPI.pkg"
    install_cmd="pkg-static add"
    ;;
  25.11.1*)
    package_family="restapi_v2"
    version_dir="2.8"
    default_release_tag="v2.10.0"
    package_name="pfSense-25.11.1-pkg-RESTAPI.pkg"
    install_cmd="pkg-static -C /dev/null add"
    ;;
  26.03.1*)
    package_family="restapi_v2"
    version_dir="2.8"
    default_release_tag="v2.10.0"
    package_name="pfSense-26.03.1-pkg-RESTAPI.pkg"
    install_cmd="pkg-static -C /dev/null add"
    ;;
  26.03*)
    package_family="restapi_v2"
    version_dir="2.8"
    default_release_tag="v2.10.0"
    package_name="pfSense-26.03-pkg-RESTAPI.pkg"
    install_cmd="pkg-static -C /dev/null add"
    ;;
  *)
    echo "versao=$version | status=nao_suportada_pelo_script | confira pacote compativel no GitHub"
    exit 10
    ;;
esac

release_tag="${release_override:-$default_release_tag}"
case "$release_tag" in
  v*) ;;
  *)
    echo "release_invalido=$release_tag | esperado formato como v2.4.3"
    exit 16
    ;;
esac
if [ -n "$package_base_url" ]; then
  package_base_url="${package_base_url%/}"
  package_url="${package_base_url}/${version_dir}/${package_name}"
else
  package_url="${repo_url}/${release_tag}/${package_name}"
fi
installed_version=""
installed_command=""
if command -v pfsense-restapi >/dev/null 2>&1; then
  installed_command="pfsense-restapi"
  installed_version="$(pfsense-restapi version 2>/dev/null | tr -d "\r\n" || true)"
elif command -v pfsense-api >/dev/null 2>&1; then
  installed_command="pfsense-api"
  installed_version="$(pfsense-api version 2>/dev/null | tr -d "\r\n" || true)"
fi

echo "versao=$version | familia=$package_family | pacote=$package_name | release=$release_tag"

if ! command -v fetch >/dev/null 2>&1; then
  echo "sem_fetch=nao_consigo_validar_download"
  exit 14
fi

download_path="/tmp/${package_name}"
rm -f "$download_path"
echo "validando_download=${package_url}"
if ! fetch -q -o "$download_path" "$package_url"; then
  rm -f "$download_path"
  echo "download=falhou | url=${package_url}"
  exit 13
fi

if [ ! -s "$download_path" ]; then
  rm -f "$download_path"
  echo "arquivo_baixado_invalido=${download_path}"
  exit 15
fi

download_size="$(wc -c < "$download_path" 2>/dev/null | tr -d " " || true)"
echo "download=ok | arquivo=${download_path} | bytes=${download_size}"

if [ -n "$installed_version" ]; then
  echo "ja_instalado=$installed_command $installed_version"
  rm -f "$download_path"
  if [ "$install_flag" != "1" ]; then
    echo "dry_run=instalado; nenhuma alteracao feita"
    exit 0
  fi
  if [ "$update_if_installed" = "1" ]; then
    echo "atualizando=${installed_command} update"
    "$installed_command" update
    "$installed_command" version 2>/dev/null || true
    exit 0
  fi
  echo "acao=ignorado; use -UpdateIfInstalled para atualizar instalacoes existentes"
  exit 0
fi

if [ "$install_flag" != "1" ]; then
  rm -f "$download_path"
  echo "dry_run=precheck_ok; instalaria | comando=${install_cmd} ${package_url}"
  exit 0
fi

echo "instalando=${download_path}"
${install_cmd} "${download_path}"
install_exit=$?
rm -f "$download_path"
if [ "$install_exit" -ne 0 ]; then
  echo "instalacao=falhou | exit=${install_exit}"
  exit "$install_exit"
fi
if [ "$package_family" = "api_v1" ]; then
  /etc/rc.restart_webgui
fi

if command -v pfsense-restapi >/dev/null 2>&1; then
  echo "instalacao=ok"
  pfsense-restapi version 2>/dev/null || true
  exit 0
fi
if command -v pfsense-api >/dev/null 2>&1; then
  echo "instalacao=ok"
  pfsense-api version 2>/dev/null || true
  exit 0
fi

echo "instalacao=finalizada_mas_comando_api_nao_encontrado"
exit 12
'

timeout "$((connect_timeout + 120))" \
  sshpass -e ssh "${ssh_args[@]}" "$user@$host" \
  "RESTAPI_RELEASE_OVERRIDE='$release_override' RESTAPI_INSTALL_FLAG='$install_flag' RESTAPI_UPDATE_IF_INSTALLED='$update_if_installed' RESTAPI_PACKAGE_BASE_URL='$package_base_url' sh -s" \
  <<< "$remote_script"

exit $?
