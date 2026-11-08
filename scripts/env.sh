# Source me: `source scripts/env.sh`. Works on Linux (including WSL2) and macOS.
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export LUMEN_DEV_HOME="${LUMEN_DEV_HOME:-$HOME/.local/share/lumen-dev}"
if [[ "$(uname -s)" == "Linux" ]]; then
  # libicu may be missing without sudo: run .NET in invariant mode, but allow culture names (Jellyfin needs them).
  # macOS ships ICU with the OS, so it doesn't need this.
  export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
  export DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY=false
fi

# Prints the plugin version from Directory.Build.props (portable: no GNU grep -P).
lumen_version() {
  sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "${1:-$ROOT}/Directory.Build.props" | head -n 1
}

# Prints this machine's LAN IPv4 address (empty if none), for reaching the dev server from other devices.
lan_ip() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local iface
    iface="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
    [[ -n "$iface" ]] && ipconfig getifaddr "$iface" 2>/dev/null || true
  else
    # On WSL2 this is the VM's address; other devices need WSL mirrored networking to reach it.
    hostname -I 2>/dev/null | awk '{print $1}' || true
  fi
}
