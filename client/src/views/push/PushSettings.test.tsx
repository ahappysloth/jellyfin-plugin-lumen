import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPushClient, ENDPOINT, type FakePush, installPush } from '../../../test/fakePush';
import { makeContext } from '../../../test/viewContext';
import { resetSessionCaches } from '../../util/sessionCaches';
import { PUSH_FLAG } from './lazyPush';
import { resumePush } from './push';
import { PushToggle } from './PushSettings';

const LABEL = 'Notify me when requests are ready';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let push: FakePush | null = null;

beforeEach(() => localStorage.clear());
afterEach(() => {
  push?.remove();
  push = null;
  resetSessionCaches();
  vi.unstubAllGlobals();
});

describe('PushToggle', () => {
  it('draws nothing where notifications cannot work (no Push API, as on a TV or Safari 13)', async () => {
    const client = createPushClient();
    const { container } = render(<PushToggle ctx={makeContext(client)} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
    expect(client.requests).toHaveLength(0);
  });

  it('draws nothing in the TV layout, and asks the server nothing', async () => {
    push = installPush();
    const client = createPushClient();
    const { container } = render(<PushToggle ctx={makeContext(client, { layout: 'tv' })} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
    expect(client.requests).toHaveLength(0);
  });

  it('draws nothing for a user without request features', async () => {
    push = installPush();
    const client = createPushClient({ available: false });
    const { container } = render(<PushToggle ctx={makeContext(client)} titled />);

    await waitFor(() => expect(client.requests).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('is off by default, and asks for nothing until the switch is tapped', async () => {
    push = installPush();
    render(<PushToggle ctx={makeContext(createPushClient())} />);

    const toggle = await screen.findByRole('switch', { name: LABEL });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(/even with the app closed/);
    expect(screen.queryByRole('button', { name: 'Send a test notification' })).toBeNull();
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(push.register).not.toHaveBeenCalled();
  });

  it('turns notifications on from the tap, then offers a test', async () => {
    push = installPush();
    const client = createPushClient();
    const ctx = makeContext(client);
    render(<PushToggle ctx={ctx} />);

    fireEvent.click(await screen.findByRole('switch', { name: LABEL }));

    // The prompt opens in the tap itself.
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('switch')).toHaveAccessibleDescription('On for this device.');
    expect(client.server.endpoint).toBe(ENDPOINT);
    expect(localStorage.getItem(PUSH_FLAG)).toBe(ctx.userId);

    fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Sent. It should arrive in a moment.');
  });

  it('shows as on for a device that already has them, and turns them off', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({ endpoint: ENDPOINT });
    render(<PushToggle ctx={makeContext(client)} />);

    const toggle = await screen.findByRole('switch', { name: LABEL });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
    expect(client.server.endpoint).toBeNull();
    expect(push.subscription).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send a test notification' })).toBeNull();
  });

  it("turns on by itself when the device's check on load subscribes again (the server's keys were reset)", async () => {
    // The browser still has its subscription and the permission; the server has forgotten the device.
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient();
    const ctx = makeContext(client);
    localStorage.setItem(PUSH_FLAG, ctx.userId);
    render(<PushToggle ctx={ctx} />);
    expect(await screen.findByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'false');

    await resumePush(ctx);

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(client.server.endpoint).toBe(ENDPOINT);
  });

  it('says when the browser blocks notifications, with the switch out of use', async () => {
    push = installPush({ permission: 'denied' });
    render(<PushToggle ctx={makeContext(createPushClient())} />);

    const toggle = await screen.findByRole('switch', { name: LABEL });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(/blocked for this site/);
  });

  it('becomes blocked when the user refuses the prompt', async () => {
    push = installPush({ answer: 'denied' });
    render(<PushToggle ctx={makeContext(createPushClient())} />);

    fireEvent.click(await screen.findByRole('switch', { name: LABEL }));

    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
    expect(screen.getByText(/blocked for this site/)).toBeInTheDocument();
  });

  it('explains that an iPhone in Safari needs the Home Screen app, without a switch', async () => {
    vi.stubGlobal('navigator', {
      userAgent: IPHONE,
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: false,
    });
    render(<PushToggle ctx={makeContext(createPushClient())} />);

    expect(await screen.findByText(/notifications need the Home Screen app/)).toBeInTheDocument();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it("says so when notifications couldn't be turned on, and stays off", async () => {
    push = installPush();
    push.register.mockRejectedValue(new Error('SecurityError'));
    render(<PushToggle ctx={makeContext(createPushClient())} />);

    fireEvent.click(await screen.findByRole('switch', { name: LABEL }));

    expect(await screen.findByText("Couldn't turn notifications on. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch')).not.toBeDisabled();
  });

  it("shows the server's reason when a test doesn't arrive, and the switch as it then is", async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({ endpoint: ENDPOINT });
    const respond = client.respond;
    client.respond = (request) => {
      if (!/Push\/Test$/.test(request.url)) return respond(request);
      // The push service said the subscription is gone, so the server removed it.
      client.server.endpoint = null;
      return { Ok: false, Error: "This device's notifications have expired. Turn them off and on again." };
    };
    render(<PushToggle ctx={makeContext(client)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send a test notification' }));

    expect(await screen.findByText(/have expired/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  });

  it('asks to wait when tests are sent too fast', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({
      endpoint: ENDPOINT,
      test: () => Promise.reject(new Response(null, { status: 429 })),
    });
    render(<PushToggle ctx={makeContext(client)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Send a test notification' }));

    expect(await screen.findByText('Wait a moment before sending another test.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('sits under a Notifications heading on the profile page', async () => {
    push = installPush();
    render(<PushToggle ctx={makeContext(createPushClient())} titled />);

    const group = await screen.findByRole('region', { name: 'Notifications' });
    expect(group).toContainElement(screen.getByRole('switch', { name: LABEL }));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });
});
