import { useEffect, useRef, useState } from 'preact/hooks';
import type { UserInfo } from '../../api/types';
import { PREFERENCES_HASH } from '../../compat/jellyfin';
import { QUICK_CONNECT } from '../../compat/registry';
import { Dropdown } from '../../components/Dropdown';
import { useAutoFocus } from '../../components/useAutoFocus';
import { liftVeil } from '../../veil/veil';
import { avatarUrl, loadAccount } from '../account/account';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';
import { authorize, getUsers } from './api';
import { approveOutcome, codeFromHash, APPROVE_HASH, isCompleteCode, statusOf } from './model';
import { CodeInput } from './parts';
import { strings } from '../../strings';
import { qcStrings } from './strings';

type Problem = keyof typeof qcStrings.outcome;

/**
 * `#/quickconnect`: approve the code another device shows, signing it in. A code can arrive in the address (the QR code
 * on a TV, or a link), and that's exactly what a phishing link looks like, so the page treats it as a suggestion: it
 * fills the field, comes out of the address bar, and waits for Approve, under the account it will sign in and a warning.
 * The address's `userId` is ignored. Administrators can pick another account, as on jellyfin-web's page. (A link opened
 * while the page shows opens it afresh: lazyQuickConnect.tsx.)
 */
export function ApprovePage({ ctx }: { ctx: ViewContext }) {
  const [linked] = useState(() => codeFromHash(window.location.hash));
  const [code, setCode] = useState(linked || '');
  const [me, setMe] = useState<UserInfo | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [userId, setUserId] = useState(ctx.userId);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvedAs, setApprovedAs] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Read once, then out of the address bar (and so out of the history): only the field holds it now.
  useEffect(() => {
    if (linked) window.history.replaceState(window.history.state, '', APPROVE_HASH);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadAccount(ctx),
      // Asked afresh (the account's answer is kept for the session). No answer: assume on, and let Approve find out.
      ctx.api.getQuickConnectEnabled().catch(() => true),
    ])
      .then(async ([{ user }, on]) => {
        if (cancelled) return;
        setMe(user);
        if (!on) setProblem('disabled');
        if (user.Policy?.IsAdministrator) {
          const all = await getUsers(ctx.client).catch(() => []);
          if (!cancelled) setUsers(all);
        }
      })
      .catch(() => !cancelled && ctx.onFallback())
      .finally(() => !cancelled && liftVeil());
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  useAutoFocus(root, me !== null, ctx.layout);
  // Approved: focus moves to Done's link, so the next press doesn't land on a button that's gone. The status is always
  // on the page and only filled in, so it's announced; the link is described by its text too, in case moving focus
  // cuts the announcement short.
  useEffect(() => {
    if (approvedAs) root.current?.querySelector<HTMLElement>('[aria-describedby="lmn-qc-done"]')?.focus();
  }, [approvedAs]);

  if (!me) return <div class="lmn-browse lmn-browse__pending" aria-busy="true" />;

  const target = users.find((u) => u.Id === userId) || me;
  const avatar = avatarUrl(ctx, target, 56);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (!isCompleteCode(code)) {
      setProblem('incomplete');
      input.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await authorize(ctx.client, code, target.Id);
      setApprovedAs(target.Name);
    } catch (error) {
      const status = statusOf(error);
      // 401 is either Quick Connect switched off or this page's own sign-in run out: the server says which.
      const on = status === 401 ? await ctx.api.getQuickConnectEnabled().catch(() => undefined) : undefined;
      setProblem(approveOutcome(status, on) as Problem);
    }
    setBusy(false);
  };

  let body;
  if (problem === 'disabled')
    body = (
      <div role="alert">
        <p>{qcStrings.outcome.disabled}</p>
        {/* As the account menu: no Dashboard on a TV. */}
        {me.Policy?.IsAdministrator && ctx.layout !== 'tv' && (
          <a class="lmn-button" href={`#${QUICK_CONNECT.dashboardSettingsRoute}`}>
            {qcStrings.turnOn}
          </a>
        )}
      </div>
    );
  else if (approvedAs)
    body = (
      <a class="lmn-button lmn-button--primary" href={PREFERENCES_HASH} aria-describedby="lmn-qc-done">
        {strings.settingsMenu}
      </a>
    );
  else
    body = (
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label for="lmn-qc-code">{qcStrings.code}</label>
        <CodeInput
          id="lmn-qc-code"
          inputRef={input}
          value={code}
          onChange={(next) => {
            setCode(next);
            setProblem(null);
          }}
          describedBy={problem ? 'lmn-qc-error lmn-qc-warning' : 'lmn-qc-warning'}
          // Only for what's wrong with the code itself, not "Couldn't reach the server" and the like.
          invalid={problem === 'incomplete' || problem === 'invalid' || problem === 'used'}
        />
        {problem && (
          <p id="lmn-qc-error" class="lmn-qc-approve__error" role="alert">
            {qcStrings.outcome[problem]}
          </p>
        )}
        <p id="lmn-qc-warning" class="lmn-qc-approve__warning">
          {linked !== null && code === linked && <strong>{qcStrings.fromLink}</strong>}
          {qcStrings.warning}
          {target.Policy?.IsAdministrator && qcStrings.adminAccess}
        </p>
        <button type="submit" class="lmn-button lmn-button--primary" disabled={busy}>
          {qcStrings.approve}
        </button>
      </form>
    );

  return (
    <div ref={root} class="lmn-browse lmn-qc-approve">
      <h1 class="lmn-browse__title">{strings.settings.quickConnect[0]}</h1>
      <div class="lmn-qc-approve__account">
        <span class="lmn-profile__avatar" aria-hidden="true">
          {avatar ? <img src={avatar} alt="" /> : initials(target.Name)}
        </span>
        <p>
          <span>{qcStrings.signsInAs}</span>
          <strong>{target.Name}</strong>
        </p>
        {users.length > 1 && !approvedAs && (
          <Dropdown
            label={qcStrings.signsInAs}
            hideLabel
            value={target.Id}
            options={users.map((u) => ({ value: u.Id, label: u.Name }))}
            onChange={(id) => {
              setUserId(id);
              if (problem !== 'disabled') setProblem(null);
            }}
          />
        )}
      </div>
      <p id="lmn-qc-done" role="status">
        {approvedAs && qcStrings.approved(approvedAs)}
      </p>
      {body}
      <p>{qcStrings.how}</p>
    </div>
  );
}
