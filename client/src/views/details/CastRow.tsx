import type { Person } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl } from '../../components/images';
import { strings } from '../../strings';

const MAX_CAST = 15;

interface Props {
  people: Person[];
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onSelect: (person: Person) => void;
}

export function CastRow({ people, client, onSelect }: Props) {
  const cast = people.filter((p) => p.Type === 'Actor').slice(0, MAX_CAST);
  if (cast.length === 0) return null;
  return (
    <section class="lmn-row lmn-cast" aria-label={strings.cast}>
      <h2 class="lmn-row__title">{strings.cast}</h2>
      <div class="lmn-row__scroller focuscontainer-x">
        {cast.map((person) => (
          <button key={person.Id} type="button" class="lmn-person" onClick={() => onSelect(person)}>
            {person.PrimaryImageTag ? (
              <img
                class="lmn-person__photo"
                src={imageUrl(
                  client,
                  { itemId: person.Id, type: 'Primary', tag: person.PrimaryImageTag },
                  { width: 120, height: 120 },
                )}
                alt=""
                loading="lazy"
              />
            ) : (
              <span class="lmn-person__photo" />
            )}
            <span class="lmn-person__name">{person.Name}</span>
            {person.Role && <span class="lmn-person__role">{person.Role}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
