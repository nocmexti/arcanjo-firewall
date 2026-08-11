#!/usr/bin/env bash
set -u

host="${1:?host obrigatorio}"
user="${2:?usuario obrigatorio}"
port="${3:-2222}"
connect_timeout="${4:-8}"

if [ -z "${SSHPASS:-}" ]; then
  IFS= read -r SSHPASS || {
    echo "nao foi possivel ler a senha pelo stdin"
    exit 98
  }
fi
SSHPASS="$(printf "%s" "$SSHPASS" | tr -d "\r")"
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

timeout "$((connect_timeout + 10))" \
  sshpass -e ssh "${ssh_args[@]}" "$user@$host" \
  "printf 'autenticado'; printf ' | hostname='; hostname 2>/dev/null || true; printf ' | version='; cat /etc/version 2>/dev/null || true"

exit $?
