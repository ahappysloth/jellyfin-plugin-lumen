using System.Reflection;
using System.Runtime.Loader;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Whether an assembly (another plugin) is loaded in any load context, looked up at most once per interval until it's
/// found, since Jellyfin loads each plugin in a context of its own; once found, it stays found (a plugin is only unloaded
/// by a restart). Cheap enough to ask on every request.
/// </summary>
internal sealed class AssemblyWatch
{
    private readonly string _name;
    private readonly TimeProvider _time;
    private readonly Func<IEnumerable<Assembly>> _assemblies;
    private readonly TimeSpan _interval;
    private readonly Lock _gate = new();
    private long _checkedAt;
    private bool _checkedOnce;
    private volatile bool _found;

    public AssemblyWatch(string name, TimeProvider time, Func<IEnumerable<Assembly>>? assemblies = null, TimeSpan? interval = null)
    {
        _name = name;
        _time = time;
        _assemblies = assemblies ?? (() => AssemblyLoadContext.All.SelectMany(context => context.Assemblies));
        _interval = interval ?? WebStaticFiles.AssemblyRecheckInterval;
    }

    public bool IsLoaded
    {
        get
        {
            if (_found)
            {
                return true;
            }

            lock (_gate)
            {
                var now = _time.GetTimestamp();
                if (_checkedOnce && _time.GetElapsedTime(_checkedAt, now) < _interval)
                {
                    return false;
                }

                _checkedOnce = true;
                _checkedAt = now;
                _found = _assemblies().Any(assembly => string.Equals(assembly.GetName().Name, _name, StringComparison.Ordinal));
                return _found;
            }
        }
    }
}
