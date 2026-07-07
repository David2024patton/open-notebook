#!/usr/bin/env bash
# Setup SSH server at container startup.
# Called by supervisord before sshd starts.
#
# Environment variables:
#   SSH_USER     — name of the SSH user to create/rename (default: notebook)
#   SSH_PASSWORD — password for the SSH user (default: notebook)
#   SSH_PORT     — port sshd listens on (default: 2222)
#
# Key-based auth:
#   Mount your public key at /app/ssh/authorized_keys and it will be installed
#   into the user's ~/.ssh/authorized_keys automatically.

set -uo pipefail

SSH_USER="${SSH_USER:-notebook}"
SSH_PASSWORD="${SSH_PASSWORD:-notebook}"
SSH_PORT="${SSH_PORT:-2222}"

# If a stored token exists from a prior reset, use it instead of the env var
TOKEN_FILE="/app/data/.ssh_token"
if [ -f "$TOKEN_FILE" ]; then
    STORED_TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null | head -1)
    if [ -n "$STORED_TOKEN" ]; then
        SSH_PASSWORD="$STORED_TOKEN"
    fi
fi

# Ensure host keys exist. ssh-keygen -A returns non-zero if keys already
# exist, which is fine — don't let it abort the script.
ssh-keygen -A 2>/dev/null || true
mkdir -p /run/sshd

# If the desired user doesn't exist, create it. If it does, just set the password.
if ! id "$SSH_USER" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$SSH_USER"
fi
echo "${SSH_USER}:${SSH_PASSWORD}" | chpasswd

# Install authorized_keys if mounted
if [ -f /app/ssh/authorized_keys ]; then
    HOME_DIR=$(getent passwd "$SSH_USER" | cut -d: -f6)
    mkdir -p "$HOME_DIR/.ssh"
    cp /app/ssh/authorized_keys "$HOME_DIR/.ssh/authorized_keys"
    chmod 600 "$HOME_DIR/.ssh/authorized_keys"
    chown -R "$SSH_USER:$SSH_USER" "$HOME_DIR/.ssh"
fi

# Update AllowUsers in sshd_config to permit the configured user
sed -i "s/^AllowUsers.*/AllowUsers ${SSH_USER}/" /etc/ssh/sshd_config

# Configure the port sshd listens on
if grep -q "^Port " /etc/ssh/sshd_config; then
    sed -i "s/^Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config
else
    echo "Port ${SSH_PORT}" >> /etc/ssh/sshd_config
fi

# venv permissions are set at build time — no need to chmod 36k files at runtime

echo "[setup-ssh] SSH ready: user='${SSH_USER}' port=${SSH_PORT}"