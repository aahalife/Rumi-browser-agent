import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HeartPulse, LockKeyhole } from 'lucide-react';
import { App as Portal } from '../../agentic-portal-demo/portal/src/App';
import '../../agentic-portal-demo/portal/src/styles.css';
import './index.css';
import { PortalHome } from './pages/PortalHome';
import { BillingPage, VideoVisitsPage } from './pages/PortalExtras';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const accessSchema = z.object({ code: z.string().min(16, 'Use the private access code supplied by your host.').max(256) });
type AccessForm = z.infer<typeof accessSchema>;

async function responseError(response: Response): Promise<Error> {
  const body: { detail?: string } = await response.json().catch(() => ({}));
  return new Error(body.detail ?? 'Unable to connect. Please try again.');
}

function PrivatePortal() {
  const queryClient = useQueryClient();
  const form = useForm<AccessForm>({ resolver: zodResolver(accessSchema), defaultValues: { code: '' } });
  const access = useQuery({
    queryKey: ['private-demo-access'],
    queryFn: async (): Promise<boolean> => {
      const response = await fetch('/~api/demo/status', { cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 403) return false;
      if (!response.ok) throw await responseError(response);
      return true;
    },
  });
  const unlock = useMutation({
    mutationFn: async ({ code }: AccessForm): Promise<void> => {
      const response = await fetch('/~api/demo/access', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Demo-Key': code }, body: '{}' });
      if (!response.ok) throw await responseError(response);
    },
    onSuccess: () => {
      form.reset();
      queryClient.setQueryData(['private-demo-access'], true);
    },
  });
  if (access.data) return <Portal home={<PortalHome />} billing={<BillingPage />} videoVisits={<VideoVisitsPage />} />;
  return <main className="app login-app">
    <div className="page">
      <div className="login-brand"><div className="mark"><HeartPulse aria-hidden="true" /></div><span className="brand-line">Your care. All together.</span><span className="brand-title">AmalgamRx Hospitals</span></div>
      <h1 className="page-title">Your private demo</h1>
      <form className="card form" onSubmit={form.handleSubmit(values => unlock.mutate(values))}>
        <LockKeyhole className="mb-2 h-7 w-7" aria-hidden="true" />
        <p>Enter your invitation’s access code, then sign in to the fictional patient portal.</p>
        <label htmlFor="private-code">Private access code</label>
        <input id="private-code" type="password" autoComplete="off" autoCapitalize="none" maxLength={256} {...form.register('code')} aria-invalid={!!form.formState.errors.code} />
        {form.formState.errors.code && <p role="alert">{form.formState.errors.code.message}</p>}
        {(unlock.error || access.error) && <p role="alert">{(unlock.error || access.error)?.message}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={unlock.isPending || access.isPending}>{unlock.isPending ? 'Checking access…' : access.isPending ? 'Connecting…' : 'Continue securely'}</button>
        {access.isError && <button type="button" className="btn btn-block" onClick={() => void access.refetch()}>Retry connection</button>}
      </form>
      <aside className="demo-box"><p>Fictional records, shared with your demo group.</p><p>Do not enter real patient information. This demo is not connected to a healthcare provider.</p></aside>
    </div>
  </main>;
}

export default function App() {
  if (!window.location.pathname.startsWith('/portal')) {
    window.location.replace('/portal/');
    return null;
  }
  return <QueryClientProvider client={client}><PrivatePortal /></QueryClientProvider>;
}
