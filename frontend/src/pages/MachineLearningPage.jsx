import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BrainCircuit, CalendarDays, RefreshCw } from 'lucide-react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import client, { getApiErrorMessage } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';

const dateText = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString() : '—';
const money = value => `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const metric = value => value == null ? '—' : Number(value).toFixed(4);

function ForecastChart({ title, subtitle, data }) {
  return (
    <Card padding={false} className="rounded-[24px]">
      <div className="p-5 md:p-6">
        <CardHeader title={title} subtitle={subtitle} className="mb-2" />
        {data.length ? <div className="h-[340px] w-full" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 16, left: 8, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5ECE1" />
              <XAxis dataKey="date" tickFormatter={dateText} minTickGap={24} fontSize={10} />
              <YAxis fontSize={10} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <Tooltip labelFormatter={dateText} formatter={value => [money(value)]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="actual" name="Actual sales" stroke="#2E1A11" strokeWidth={1.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="predicted" name="Linear regression" stroke="#D4AF37" strokeWidth={2.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="baseline" name="Training mean baseline" stroke="#8C7A6B" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div> : <p className="rounded-xl bg-cream/70 p-6 text-sm font-semibold text-espresso/60">Generate a forecast to display actual and predicted sales.</p>}
      </div>
    </Card>
  );
}

export default function MachineLearningPage() {
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [horizon, setHorizon] = useState(7);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.get('/api/forecasting/ml/');
      setReport(response.data.latest);
      setHistory(response.data.history || []);
      setError('');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Forecast data could not be loaded.'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const retrain = async () => {
    setTraining(true);
    try {
      const response = await client.post('/api/forecasting/ml/', { horizon_days: Number(horizon) });
      setReport(response.data);
      setHistory(previous => [response.data, ...previous.filter(row => row.id !== response.data.id)].slice(0, 20));
      setError('');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Forecast batch could not be generated.'));
    } finally { setTraining(false); }
  };

  const chartData = useMemo(() => {
    if (!report) return [];
    const rows = new Map();
    (report.actual_history || []).forEach(row => rows.set(row.date, { date: row.date, actual: row.actual_revenue }));
    (report.backtest || []).forEach(row => rows.set(row.date, {
      ...rows.get(row.date), date: row.date, actual: row.actual_revenue,
      predicted: row.predicted_revenue, baseline: row.baseline_revenue,
    }));
    (report.sales_forecast || []).forEach(row => rows.set(row.date, { date: row.date, predicted: row.predicted_revenue }));
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [report]);

  const result = report?.evaluation?.sales || {};
  const modelMetrics = result.backtest || {};
  const baseline = result.baseline || {};
  const computation = result.training_computation || {};
  const finalFit = result.final_model_computation || {};
  const quality = report?.dataset || {};

  return (
    <main className="min-h-screen bg-cream px-4 py-6 md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 rounded-[26px] bg-espresso p-6 text-white md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <Link to="/admin" className="text-xs font-bold text-gold hover:underline">← Admin dashboard</Link>
            <p className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-gold"><BrainCircuit size={15} /> CAV InsightHub</p>
            <h1 className="mt-2 text-3xl font-black">Daily Sales Forecast</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/65">Linear regression over the supplied synthetic daily sales history. Values are in Philippine pesos (PHP).</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-white/80">Forecast horizon (days)
              <input aria-label="Forecast horizon in days" type="number" min="1" max="90" value={horizon} onChange={event => setHorizon(event.target.value)} className="mt-1 block w-28 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white" />
            </label>
            <button type="button" onClick={retrain} disabled={training || loading || Number(horizon) < 1 || Number(horizon) > 90} className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-black text-espresso disabled:opacity-50">
              <RefreshCw size={16} className={training ? 'animate-spin' : ''} /> {training ? 'Calculating…' : 'Generate forecast'}
            </button>
          </div>
        </header>

        <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          Synthetic dataset: CAV_Three_Year_Synthetic_Sales-Daily sales.csv. Results from synthetic data do not establish real-world forecasting accuracy.
        </div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
        {loading && <p role="status" className="rounded-xl bg-white p-5 text-sm font-semibold text-espresso/60">Loading saved forecast records…</p>}
        {!loading && !report && <Card><p className="font-bold text-espresso">No forecast run saved yet.</p><p className="mt-1 text-sm text-espresso/60">Generate a forecast to validate the synthetic dataset, evaluate the holdout, and calculate future sales.</p></Card>}

        {report && <>
          <Card className="!p-5">
            <CardHeader title="Dataset validation" subtitle="Source columns and data-quality handling for this run." />
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p><b>Source:</b> {quality.source_file || 'Unavailable'}</p>
              <p><b>Label:</b> {quality.dataset_type || 'Synthetic dataset'}</p>
              <p><b>Rows:</b> {quality.raw_rows ?? '—'} raw / {quality.valid_rows ?? '—'} valid</p>
              <p><b>Daily span:</b> {dateText(quality.start_date)} – {dateText(quality.end_date)}</p>
              <p className="sm:col-span-2"><b>Columns:</b> {(quality.columns || []).join(', ') || '—'}</p>
              <p><b>Exact duplicates removed:</b> {quality.exact_duplicate_rows_removed ?? '—'}</p>
              <p><b>Repeated dates aggregated:</b> {quality.duplicate_date_rows_aggregated ?? '—'}</p>
              <p><b>Invalid date rows skipped:</b> {quality.invalid_date_rows_skipped ?? '—'}</p>
              <p><b>Missing/invalid sales rows skipped:</b> {quality.missing_or_invalid_sales_rows_skipped ?? '—'}</p>
              <p><b>Missing calendar days filled with zero:</b> {quality.imputed_missing_days ?? '—'}</p>
              <p><b>Positive-sales days:</b> {quality.observed_sales_days ?? '—'} / {quality.calendar_days ?? '—'}</p>
            </div>
          </Card>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="!p-5"><div className="flex items-center justify-between text-gold-dark"><Activity size={17} /><span className="text-[10px] font-black uppercase tracking-widest text-espresso/45">Model</span></div><p className="mt-3 text-sm font-black text-espresso">Daily linear regression</p></Card>
            <Card className="!p-5"><div className="flex items-center justify-between text-gold-dark"><CalendarDays size={17} /><span className="text-[10px] font-black uppercase tracking-widest text-espresso/45">Future horizon</span></div><p className="mt-3 text-lg font-black text-espresso">{report.sales_forecast?.length || 0} days</p></Card>
            <Card className="!p-5"><div className="flex items-center justify-between text-gold-dark"><BrainCircuit size={17} /><span className="text-[10px] font-black uppercase tracking-widest text-espresso/45">Holdout MAE</span></div><p className="mt-3 text-lg font-black text-espresso">{modelMetrics.mae == null ? '—' : money(modelMetrics.mae)}</p></Card>
            <Card className="!p-5"><div className="flex items-center justify-between text-gold-dark"><Activity size={17} /><span className="text-[10px] font-black uppercase tracking-widest text-espresso/45">Holdout R²</span></div><p className="mt-3 text-lg font-black text-espresso">{metric(modelMetrics.r2)}</p></Card>
          </section>

          <Card className="!p-4 text-xs text-espresso/65">
            <div className="flex flex-wrap gap-x-6 gap-y-2"><span>Run: <b>{report.model_version}</b></span><span>Generated: <b>{new Date(report.generated_at).toLocaleString()}</b></span><span>Full history fit: <b>{dateText(report.training_period?.start)} – {dateText(report.training_period?.end)}</b></span><span>Chronological holdout: <b>{dateText(report.testing_period?.start)} – {dateText(report.testing_period?.end)}</b></span><span>Train/test samples: <b>{result.train_count ?? '—'} / {result.test_count ?? '—'}</b></span></div>
          </Card>

          <ForecastChart title="Actual versus predicted daily sales" subtitle="Dark line: actual values. Gold line: linear regression on held-out dates and future dates. Dashed line: training-mean baseline on the holdout." data={chartData} />

          <Card padding={false} className="rounded-[24px]">
            <div className="p-5 md:p-6"><CardHeader title="Chronological evaluation" subtitle="The model is fitted on the first 80% of dates. Only the later 20% is used to calculate test metrics." className="mb-3" />
              <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-cream text-espresso/65"><tr>{['Method', 'MAE (PHP)', 'RMSE (PHP)', 'R²'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
                <tr className="border-t border-espresso/5"><td className="p-3 font-bold">Linear regression</td><td className="p-3">{metric(modelMetrics.mae)}</td><td className="p-3">{metric(modelMetrics.rmse)}</td><td className="p-3">{metric(modelMetrics.r2)}</td></tr>
                <tr className="border-t border-espresso/5"><td className="p-3 font-bold">Training mean baseline ({money(baseline.value)}/day)</td><td className="p-3">{metric(baseline.mae)}</td><td className="p-3">{metric(baseline.rmse)}</td><td className="p-3">{metric(baseline.r2)}</td></tr>
              </tbody></table></div>
              <p className="mt-3 text-xs text-espresso/55">Test dates: {dateText(result.testing_start)} – {dateText(result.testing_end)} ({result.test_count ?? 0} daily observations). The baseline predicts the training-period mean for every test date.</p>
            </div>
          </Card>

          <Card padding={false} className="rounded-[24px]">
            <div className="p-5 md:p-6"><CardHeader title="Worked training computation" subtitle={`These sums come from the first ${computation.sample_count} chronological training dates; x is elapsed days from the first date and y is daily sales in PHP.`} className="mb-3" />
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <p><b>n:</b> {computation.sample_count}</p><p><b>Σx:</b> {Number(computation.sum_x).toLocaleString()}</p><p><b>Σy:</b> {money(computation.sum_y)}</p><p><b>Σx²:</b> {Number(computation.sum_x2).toLocaleString()}</p><p><b>Σxy:</b> {Number(computation.sum_xy).toLocaleString(undefined, { maximumFractionDigits: 2 })} PHP·days</p><p><b>Training slope m:</b> {Number(computation.slope).toFixed(10)} PHP per elapsed day</p><p><b>Training intercept b:</b> {money(computation.intercept)}</p>
              </div>
              <div className="mt-4 space-y-2 rounded-xl bg-cream/70 p-4 text-sm">
                <p><b>Formulas</b></p>
                <p>ŷ = mx + b</p>
                <p>m = [nΣxy − (Σx)(Σy)] / [nΣx² − (Σx)²]</p>
                <p>b = (Σy − mΣx) / n</p>
                <p><b>Substitution:</b> m = [{computation.sample_count} × {Number(computation.sum_xy).toLocaleString(undefined, { maximumFractionDigits: 2 })} − {Number(computation.sum_x).toLocaleString()} × {Number(computation.sum_y).toLocaleString()}] / [{computation.sample_count} × {Number(computation.sum_x2).toLocaleString()} − {Number(computation.sum_x).toLocaleString()}²] = {Number(computation.slope).toFixed(10)}.</p>
                <p><b>Example held-out prediction:</b> {dateText(result.testing_start)}: {money(report.backtest?.[0]?.predicted_revenue)}; actual {money(report.backtest?.[0]?.actual_revenue)}.</p>
                <p><b>Future example:</b> {dateText(report.sales_forecast?.[0]?.date)}: {money(report.sales_forecast?.[0]?.predicted_revenue)}. The future model is refit on all {finalFit.sample_count} valid daily values; b = {money(finalFit.intercept)} and m = {Number(finalFit.slope).toFixed(10)} PHP per elapsed day.</p>
              </div>
            </div>
          </Card>

          <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="Future daily sales forecast" subtitle="Model predictions from the day after the last historical date. Values are in PHP." className="mb-3" />
            <div className="overflow-x-auto"><table className="w-full min-w-[360px] text-left text-sm"><thead className="bg-cream text-espresso/65"><tr><th className="p-3">Date</th><th className="p-3 text-right">Predicted sales (PHP)</th></tr></thead><tbody>{(report.sales_forecast || []).map(row => <tr key={row.date} className="border-t border-espresso/5"><td className="p-3">{dateText(row.date)}</td><td className="p-3 text-right font-bold">{money(row.predicted_revenue)}</td></tr>)}</tbody></table></div>
          </div></Card>

          <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="How it works" subtitle="The sales forecast uses one input feature: elapsed days." className="mb-3" />
            <ol className="list-decimal space-y-2 pl-5 text-sm text-espresso/75">
              <li>Read the CSV columns, parse dates and non-negative finite sales, sort dates chronologically, and remove exact duplicate rows. Distinct rows for one date are summed. Invalid date/sales rows are skipped, and missing calendar dates between the first and last date are assigned zero sales.</li>
              <li>Set x to elapsed calendar days from the first date and y to daily sales in PHP. Ordinary least squares finds slope m and intercept b that minimize squared errors for ŷ = mx + b.</li>
              <li>For evaluation, fit only on the first 80% of dates and predict the later 20%. Compare those predictions with actual held-out sales and a baseline that always predicts the training mean; calculate MAE, RMSE, and R².</li>
              <li>After evaluation, refit the same line using all historical dates. For each future day, increase elapsed-day x and calculate ŷ = mx + b.</li>
            </ol>
            <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Linear regression models a trend and may miss seasonality or other repeating patterns. Results from this synthetic dataset do not establish real-world accuracy. The current holdout comparison is shown above, including where the baseline performs better.</p>
          </div></Card>

          <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="Forecast run history" subtitle="Saved run times, horizons, and model versions." className="mb-3" />{history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-cream text-espresso/60"><tr>{['Generated', 'Horizon', 'Training period', 'Model version', 'Status'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{history.map(run => <tr key={run.id} className="border-t border-espresso/5"><td className="p-3">{new Date(run.generated_at).toLocaleString()}</td><td className="p-3">{run.horizon_days} days</td><td className="p-3">{dateText(run.training_period?.start)} – {dateText(run.training_period?.end)}</td><td className="p-3 font-mono">{run.model_version}</td><td className="p-3">{run.status}</td></tr>)}</tbody></table></div> : <p className="p-4 text-sm text-espresso/55">No saved runs.</p>}</div></Card>
        </>}
      </div>
    </main>
  );
}
