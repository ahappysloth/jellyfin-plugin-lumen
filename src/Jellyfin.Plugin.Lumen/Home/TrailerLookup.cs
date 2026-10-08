using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Finds an item's first local trailer.</summary>
public interface ITrailerLookup
{
    Guid? GetLocalTrailerId(BaseItem item, User user);
}

/// <summary>Thin adapter over <see cref="BaseItem.GetExtras(IReadOnlyCollection{ExtraType}, User)"/> (static locator; E2E-verified).</summary>
public sealed class TrailerLookup : ITrailerLookup
{
    public Guid? GetLocalTrailerId(BaseItem item, User user) => item.GetExtras([ExtraType.Trailer], user).FirstOrDefault()?.Id;
}
