#!/usr/bin/env bash
set -euo pipefail

hosts_file="${1:?hosts file}"
agent_file="${2:?agent file}"
default_user="${3:-admin}"
default_port="${4:-2222}"
install="${5:-0}"

if ! command -v sshpass >/dev/null 2>&1; then
  echo "ERRO: sshpass nao encontrado no WSL. Instale com: sudo apt-get install sshpass" >&2
  exit 1
fi

if [ -z "${SSHPASS:-}" ]; then
  IFS= read -r SSHPASS
  SSHPASS="$(printf "%s" "$SSHPASS" | tr -d "\r")"
  export SSHPASS
fi

tmp_remote="/tmp/fleet-guardian-agent.php"
remote_agent="/usr/local/www/fleet-guardian-agent.php"
remote_secret="/usr/local/etc/fleet-guardian-agent.secret"
agent_b64="$(base64 "$agent_file" | tr -d '\r\n')"

remote_script='
set -u
tmp_remote="/tmp/fleet-guardian-agent.php"
remote_agent="/usr/local/www/fleet-guardian-agent.php"
remote_secret="/usr/local/etc/fleet-guardian-agent.secret"

printf "%s" "$FLEET_AGENT_B64" | base64 -d > "$tmp_remote" || exit 20
install -o root -g wheel -m 0640 "$tmp_remote" "$remote_agent" || exit 21
rm -f "$tmp_remote"
if [ ! -s "$remote_secret" ]; then
  umask 077
  openssl rand -hex 32 > "$remote_secret" || exit 22
fi
chown root:wheel "$remote_secret" || true
chmod 0640 "$remote_secret" || true
printf "AGENT_OK secret_sha256="
sha256 -q "$remote_secret" 2>/dev/null || sha256sum "$remote_secret" | awk "{print \$1}"
'

while IFS= read -r raw || [ -n "$raw" ]; do
  line="$(printf '%s' "$raw" | sed 's/\r$//')"
  [ -z "$line" ] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  user="$default_user"
  port="$default_port"
  host="$line"

  if [[ "$host" == *@* ]]; then
    user="${host%@*}"
    host="${host#*@}"
  fi
  if [[ "$host" == *:* ]]; then
    port="${host##*:}"
    host="${host%:*}"
  fi

  printf 'Processando %s@%s:%s ... ' "$user" "$host" "$port"

  if [ "$install" != "1" ]; then
    echo "DRY_RUN"
    continue
  fi

  ssh_args=(
    -p "$port"
    -o BatchMode=no
    -o PreferredAuthentications=password,keyboard-interactive
    -o PubkeyAuthentication=no
    -o KbdInteractiveAuthentication=yes
    -o ChallengeResponseAuthentication=yes
    -o NumberOfPasswordPrompts=1
    -o ConnectTimeout=12
    -o StrictHostKeyChecking=accept-new
    -o LogLevel=ERROR
  )

  if timeout 45 sshpass -e ssh "${ssh_args[@]}" "$user@$host" \
    "FLEET_AGENT_B64='$agent_b64' sh -s" <<< "$remote_script" | tr '\n' ' '; then
    :
  else
    code=$?
    echo "ERRO_$code"
    continue
  fi
  echo
done < "$hosts_file"
