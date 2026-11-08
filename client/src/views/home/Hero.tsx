import { useEffect, useState } from 'preact/hooks';
import type { BadgeKey, BaseItem, ClientConfig, HeroItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { cardMeta } from '../../components/Card';
import { Icon } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { TrailerPreview } from './TrailerPreview';

interface Props {
  items: HeroItem[];
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  config: ClientConfig;
  badges?: Record<string, BadgeKey>;
  onPlay: (item: BaseItem) => void;
  onInfo: (item: BaseItem) => void;
}

export function Hero({ items, client, config, badges, onPlay, onInfo }: Props) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [stopped, setStopped] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const paused = hovered || stopped;

  useEffect(() => {
    if (items.length < 2 || paused) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      config.HeroIntervalSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [items.length, paused, config.HeroIntervalSeconds]);

  const current = items[index % items.length];
  if (!current) return null;
  const item = current.Item;
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  const trailerId = config.TrailerPreview && !reducedMotion ? current.TrailerItemId : null;
  const badge = badges?.[item.Id];
  const meta = [...cardMeta(item), ...(item.Genres ?? []).slice(0, 2)];

  return (
    <section
      class="lmn-hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusIn={() => setHovered(true)}
      onFocusOut={() => setHovered(false)}
    >
      {backdrop && (
        <img
          key={item.Id}
          class="lmn-hero__backdrop"
          src={imageUrl(client, backdrop, { width: 1920 })}
          alt=""
        />
      )}
      {trailerId && (
        <TrailerPreview
          key={trailerId}
          trailerId={trailerId}
          delaySeconds={config.TrailerDelaySeconds}
          client={client}
        />
      )}
      <div class="lmn-hero__scrim" />
      <div class="lmn-hero__content" key={`content-${item.Id}`}>
        {logo ? (
          <img class="lmn-hero__logo" src={imageUrl(client, logo, { width: 840 })} alt={item.Name} />
        ) : (
          <h2 class="lmn-hero__title">{item.Name}</h2>
        )}
        {badge && <p class="lmn-hero__badge">{strings.badges[badge]}</p>}
        {meta.length > 0 && (
          <p class="lmn-meta lmn-hero__meta">
            {meta.map((part, i) => (
              <span key={part}>
                {i === 0 && item.CommunityRating ? <Icon name="star" size={13} class="lmn-star" /> : null}
                {part}
              </span>
            ))}
          </p>
        )}
        {item.Overview && <p class="lmn-hero__overview">{item.Overview}</p>}
        <div class="lmn-actions">
          <button
            type="button"
            class="lmn-button lmn-button--primary lmn-autofocus"
            onClick={() => onPlay(item)}
          >
            <Icon name="play" />
            {strings.play}
          </button>
          <button
            type="button"
            class="lmn-button lmn-button--secondary"
            aria-label={strings.moreInfo}
            onClick={() => onInfo(item)}
          >
            <Icon name="info" />
            <span class="lmn-button__label">{strings.moreInfo}</span>
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <div class="lmn-hero__controls">
          <div class="lmn-hero__pager" role="tablist">
            {items.map((h, i) => (
              <button
                key={h.Item.Id}
                type="button"
                role="tab"
                tabIndex={-1}
                aria-selected={i === index}
                aria-label={`Show ${h.Item.Name}`}
                class={`lmn-hero__dash${i === index ? ' is-active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            class="lmn-icon-button"
            tabIndex={-1}
            aria-label={stopped ? strings.resumeRotation : strings.pauseRotation}
            onClick={() => setStopped((s) => !s)}
          >
            <Icon name={stopped ? 'play' : 'pause'} size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
