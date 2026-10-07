# Source me: `source scripts/env.sh`
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export LUMEN_DEV_HOME="${LUMEN_DEV_HOME:-$HOME/.local/share/lumen-dev}"
# No libicu without sudo: run .NET in invariant mode, but allow culture names (Jellyfin needs them).
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
export DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY=false
