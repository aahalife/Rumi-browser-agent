import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, FileText, Video, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Layout } from '../../../agentic-portal-demo/portal/src/components/Layout';
import { useTitle } from '../../../agentic-portal-demo/portal/src/lib/useTitle';

/** Illustrative billing only; never collects or processes payment details. */
export function BillingPage() {
  useTitle('Billing');
  const [expanded, setExpanded] = useState<boolean>(false);
  return <Layout title="Billing" subtitle="A clear view of your care costs.">
    <aside className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">Sample billing demonstration. These are illustrative amounts, not a patient balance. No payments are accepted.</aside>
    <section className="card shadow-sm"><CreditCard className="h-8 w-8 text-[#9563a8]" aria-hidden="true" /><h2>Example statement</h2><p className="text-sm text-slate-500">Office visit · Sample account</p><p className="!my-4 text-4xl text-[#236ca3]">$25.00</p><p>Illustrative patient responsibility after insurance.</p><button type="button" className="btn btn-secondary btn-block" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide statement' : 'View statement'}</button>
      {expanded && <dl className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4"><div className="flex justify-between gap-4"><dt>Office visit</dt><dd>$150.00</dd></div><div className="flex justify-between gap-4"><dt>Example insurance payment</dt><dd>−$125.00</dd></div><div className="flex justify-between gap-4 font-bold"><dt>Example copay</dt><dd>$25.00</dd></div></dl>}
    </section>
    <section className="card"><FileText className="text-[#9563a8]" aria-hidden="true" /><h2>Questions about your bill?</h2><p>In a connected hospital portal, this is where you could review statements and ask the billing team for help.</p><Link className="btn btn-secondary btn-block" to="/messages">Open Messages</Link></section>
  </Layout>;
}

/** A preparation checklist, not a simulated clinician connection. */
export function VideoVisitsPage() {
  useTitle('Video Visits');
  const [checked, setChecked] = useState<string[]>([]);
  const items = ['Find a quiet, private space', 'Charge your phone or computer', 'Have your medication list nearby', 'Check your internet connection'];
  return <Layout title="Video Visits" subtitle="Get ready for care from wherever you are.">
    <section className="card text-center"><Video className="mx-auto h-12 w-12 text-[#9563a8]" aria-hidden="true" /><h2>Prepare for your visit</h2><p>This fictional demo does not connect to a clinician or start a video call. Use the checklist to explore visit preparation.</p></section>
    <section className="card"><h2>Before your visit</h2><div className="space-y-2">{items.map(item => <label key={item} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-solid border-slate-200 p-3"><input type="checkbox" className="h-5 w-5 accent-emerald-700" checked={checked.includes(item)} onChange={event => setChecked(previous => event.target.checked ? [...previous, item] : previous.filter(value => value !== item))} /><span>{item}</span></label>)}</div><p className="mt-4 flex items-center gap-2 text-sm text-emerald-800" role="status"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{checked.length} of {items.length} preparation steps complete</p></section>
    <Link className="btn btn-primary btn-block" to="/visits">View your appointments</Link><Link className="btn btn-secondary btn-block" to="/care-team">Contact your care team</Link>
    <p className="mt-6 flex items-start gap-2 text-sm text-slate-500"><ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />No camera or microphone is activated by this page.</p>
  </Layout>;
}
