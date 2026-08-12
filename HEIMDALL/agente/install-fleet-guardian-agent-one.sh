#!/usr/bin/env bash
set -u

host="${1:?host obrigatorio}"
user="${2:?usuario obrigatorio}"
port="${3:-2222}"
agent_file="${4:?agent file}"
install="${5:-0}"
connect_timeout="${6:-12}"

if [ -z "${SSHPASS:-}" ]; then
  IFS= read -r SSHPASS || {
    echo "nao foi possivel ler a senha pelo stdin"
    exit 98
  }
fi
SSHPASS="$(printf "%s" "$SSHPASS" | tr -d "\r")"
export SSHPASS

if [ "$install" != "1" ]; then
  echo "DRY_RUN"
  exit 0
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "sshpass=ausente"
  exit 2
fi

agent_b64="$(base64 "$agent_file" | tr -d '\r\n')"

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
tmp_remote="/tmp/fleet-guardian-agent.php"
remote_agent="/usr/local/www/fleet-guardian-agent.php"
remote_secret="/usr/local/etc/fleet-guardian-agent.secret"

printf "%s" "$FLEET_AGENT_B64" | base64 -d > "$tmp_remote" 2>/dev/null || printf "%s" "$FLEET_AGENT_B64" | base64 -D > "$tmp_remote" 2>/dev/null || exit 20
install -o root -g wheel -m 0644 "$tmp_remote" "$remote_agent" || exit 21
rm -f "$tmp_remote"
if [ ! -s "$remote_secret" ]; then
  umask 077
  openssl rand -hex 32 > "$remote_secret" || exit 22
fi
chown root:wheel "$remote_secret" || true
chmod 0640 "$remote_secret" || true
printf "AGENT_OK secret_sha256="
sha256 -q "$remote_secret" 2>/dev/null || sha256sum "$remote_secret" | awk "{print \$1}"
printf "agent_secret="
cat "$remote_secret"
'

timeout "$((connect_timeout + 45))" \
  sshpass -e ssh "${ssh_args[@]}" "$user@$host" \
  "FLEET_AGENT_B64='$agent_b64' sh -s" \
  <<< "$remote_script"

exit $?
