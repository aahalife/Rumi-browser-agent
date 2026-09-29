import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, CreditCard, Video, Pill, FlaskConical, Mail, ChevronRight, HeartPulse, Users, Clock3, MapPin, Stethoscope, ShieldCheck } from 'lucide-react';
import { Layout } from '../../../agentic-portal-demo/portal/src/components/Layout';
import { CheckinLink } from '../../../agentic-portal-demo/portal/src/components/CheckinLink';
import { useAuth } from '../../../agentic-portal-demo/portal/src/lib/auth';
import { apiFetch } from '../../../agentic-portal-demo/portal/src/lib/api';
import { fmtTime, parseLocal } from '../../../agentic-portal-demo/portal/src/lib/format';
import { useTitle } from '../../../agentic-portal-demo/portal/src/lib/useTitle';
import type { Appointment, Patient, LabPanel } from '../../../agentic-portal-demo/portal/src/lib/types';

const shortcuts = [
  { to: '/schedule', label: 'Schedule an appointment', icon: CalendarDays },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/video-visits', label: 'Video Visits', icon: Video },
  { to: '/medications', label: 'Medications', icon: Pill },
  { to: '/results', label: 'Test Results', icon: FlaskConical },
  { to: '/messages', label: 'Messages', icon: Mail },
];

/** Live patient dashboard; all cards link to the existing browser workflows. */
export function PortalHome() {
  useTitle('Home');
  const { patient } = useAuth();
  const appointments = useQuery({ queryKey: ['portal-home', patient?.id, 'appointments'], queryFn: () => apiFetch<Appointment[]>('/appointments?status=upcoming'), staleTime: 0 });
  const me = useQuery({ queryKey: ['portal-home', patient?.id, 'me'], queryFn: () => apiFetch<Patient>('/me'), staleTime: 0 });
  const results = useQuery({ queryKey: ['portal-home', patient?.id, 'results'], queryFn: () => apiFetch<LabPanel[]>('/results'), staleTime: 0 });
  const next = appointments.data?.[0];
  const latest = results.data?.[0];
  const date = next ? parseLocal(next.start) : null;
  const unread = me.data?.unread_messages ?? 0;
  const newResults = me.data?.new_results ?? 0;
  return <Layout title={`Welcome, ${patient?.first_name ?? ''}!`} subtitle="Your health, a little closer." greeting>
    <nav aria-label="Quick actions" className="grid grid-cols-3 gap-3 sm:gap-5 mb-7">
      {shortcuts.map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="relative flex min-h-32 flex-col items-center justify-center gap-3 rounded-[24px] border border-white bg-white px-2 py-5 text-center text-[15px] leading-tight text-slate-800 no-underline shadow-[0_6px_12px_-5px_#425d7b40] transition motion-safe:hover:-translate-y-1 hover:shadow-lg active:scale-95 sm:min-h-40 sm:text-lg">
        <Icon aria-hidden="true" className="h-9 w-9 text-[#9563a8] sm:h-11 sm:w-11" strokeWidth={1.6} />
        <span>{label}</span>
        {((to === '/messages' && unread > 0) || (to === '/results' && newResults > 0)) && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#007f62]" aria-label="New updates" />}
      </Link>)}
    </nav>

    <section aria-labelledby="next-appt" className="mb-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-md shadow-slate-200/60 sm:p-6">
      <div className="flex items-center gap-3 mb-5"><CalendarDays className="h-7 w-7 text-[#8e65a4]" aria-hidden="true" /><h2 id="next-appt" className="!m-0 !text-xl">Upcoming Office Visit</h2></div>
      {appointments.isPending && <p role="status">Loading your next appointment…</p>}
      {appointments.isError && <div role="alert"><p>We couldn’t load your appointments.</p><button type="button" className="btn btn-secondary" onClick={() => void appointments.refetch()}>Try again</button></div>}
      {next && date && <>
        <div className="flex gap-5 sm:gap-8">
          <div className="flex w-16 shrink-0 flex-col items-center text-[#236ca3]" aria-hidden="true"><span className="text-base">{date.toLocaleDateString('en-US', { month: 'short' })}</span><span className="text-5xl leading-tight">{date.getDate()}</span><span>{date.toLocaleDateString('en-US', { weekday: 'short' })}</span></div>
          <div className="min-w-0 space-y-2 text-base">
            <p className="flex items-start gap-2"><Clock3 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" /><span><span className="sr-only">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, </span>Starts at {fmtTime(next.start)}</span></p>
            <p className="flex items-start gap-2"><MapPin aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />{next.location.name}</p>
            <p className="flex items-start gap-2"><Stethoscope aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />with {next.provider.name}</p>
            <p className="text-sm text-slate-500">{next.visit_type} · {next.provider.specialty}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3"><CheckinLink appt={next} /><Link className="btn btn-secondary" to={`/visits/${next.id}`}>View details</Link></div>
      </>}
      {appointments.isSuccess && !next && <><p>No upcoming visits. Let’s find a time that works for you.</p><Link to="/schedule" className="btn btn-primary mt-4">Schedule an Appointment</Link></>}
    </section>

    <section aria-labelledby="results-heading" className="mb-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-md shadow-slate-200/60 sm:p-6">
      <div className="flex items-start gap-3"><FlaskConical aria-hidden="true" className="h-9 w-9 shrink-0 text-[#9970b2]" /><div><h2 id="results-heading" className="!m-0 !text-xl">{latest?.name ?? 'Your test results'}</h2>{latest && <p className="text-sm text-slate-500">Collected {parseLocal(latest.collected_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}</div></div>
      {results.isPending && <p className="mt-4" role="status">Loading results…</p>}
      {results.isError && <p className="mt-4" role="alert">Results are unavailable right now. Open Test Results to try again.</p>}
      {latest && <><p className="mt-4 text-base font-bold">{latest.provider.name}</p><div className="mt-3 rounded-xl border border-[#b8d3e9] bg-[#f1f7fc] p-4 text-base">{latest.notes || 'Your results are ready to review. Contact your care team with any questions.'}</div></>}
      {results.isSuccess && !latest && <p className="mt-4">No results to show yet.</p>}
      <div className="mt-4 text-center"><Link to={latest ? `/results/${latest.id}` : '/results'} className="btn btn-primary">View results</Link></div>
    </section>

    {unread > 0 && <Link to="/messages" className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 no-underline"><Mail className="text-[#9563a8]" aria-hidden="true" /><span className="flex-1">You have {unread} unread {unread === 1 ? 'message' : 'messages'}</span><ChevronRight aria-hidden="true" className="h-5 w-5" /></Link>}
    <section aria-label="More ways to manage your care" className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {[{ to: '/visits', label: 'All visits', icon: CalendarDays }, { to: '/health-summary', label: 'Health Summary', icon: HeartPulse }, { to: '/care-team', label: 'Care Team', icon: Users }].map(({ to, label, icon: Icon }) => <Link key={to} to={to} className="flex min-h-16 items-center gap-3 border-0 border-b border-solid border-slate-100 px-5 text-slate-800 no-underline last:border-b-0"><Icon aria-hidden="true" className="h-5 w-5 text-[#9563a8]" /><span className="flex-1">{label}</span><ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" /></Link>)}
    </section>
    <p className="flex items-center justify-center gap-2 text-sm text-[#53748c]"><ShieldCheck aria-hidden="true" className="h-4 w-4" />Your care. Your choices. Always.</p>
  </Layout>;
}
