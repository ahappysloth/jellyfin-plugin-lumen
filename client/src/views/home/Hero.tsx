import { useEffect, useState } from 'preact/hooks';
import type { BaseItem, ClientConfig, HeroItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl, resolveImage } from '../../components/images';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { TrailerPreview } from './TrailerPreview';

interface Props {
  items: HeroItem[];
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  config: ClientConfig;
  onPlay: (item: BaseItem) => void;
  onInfo: (item: BaseItem) => void;
}

export function Hero({ items, client, config, onPlay, onInfo }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

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

  return (
    <section
      class="lmn-hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusIn={() => setPaused(true)}
      onFocusOut={() => setPaused(false)}
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
      <div class="lmn-hero__content">
        {logo ? (
          <img class="lmn-hero__logo" src={imageUrl(client, logo, { width: 600 })} alt={item.Name} />
        ) : (
          <h1 class="lmn-hero__title">{item.Name}</h1>
        )}
        {item.Overview && <p class="lmn-hero__overview">{item.Overview}</p>}
        <div class="lmn-hero__actions">
          <button
            type="button"
            class="lmn-button lmn-button--primary lmn-autofocus"
            onClick={() => onPlay(item)}
          >
            {strings.play}
          </button>
          <button type="button" class="lmn-button" onClick={() => onInfo(item)}>
            {strings.moreInfo}
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <div class="lmn-hero__dots" role="tablist">
          {items.map((h, i) => (
            <button
              key={h.Item.Id}
              type="button"
              role="tab"
              tabIndex={-1}
              aria-selected={i === index}
              aria-label={`Show ${h.Item.Name}`}
              class={`lmn-hero__dot${i === index ? ' is-active' : ''}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
