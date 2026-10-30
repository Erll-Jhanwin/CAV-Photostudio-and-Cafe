import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BrainCircuit, CalendarDays, RefreshCw, Boxes } from 'lucide-react';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import client, { getApiErrorMessage } from '../api/client';
import { Card, CardHeader } from '../components/ui/Card';

const dateText = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString() : '—';
const money = value => `PHP ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const metric = (value, unit) => value == null ? '—' : `${Number(value).toFixed(2)} ${unit}`;

function ForecastChart({ title, subtitle, data, valueKeys, unit }) {
  return (
    <Card padding={false} className="rounded-[24px]">
      <div className="p-5 md:p-6">
        <CardHeader title={title} subtitle={subtitle} className="mb-2" />
        {data.length ? <div className="h-[300px] w-full" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5ECE1" />
              <XAxis dataKey="date" tickFormatter={dateText} fontSize={10} />
              <YAxis fontSize={10} tickFormatter={v => unit === 'PHP' ? `${Math.round(v / 1000)}k` : v} />
              <Tooltip labelFormatter={dateText} formatter={value => [unit === 'PHP' ? money(value) : `${Number(value).toFixed(2)} ${unit}`, undefined]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {valueKeys.map(([key, label, color]) => <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />)}
            </ComposedChart>
          </ResponsiveContainer>
        </div> : <p className="rounded-xl bg-cream/70 p-6 text-sm font-semibold text-espresso/60">Insufficient historical data</p>}
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

  const salesChart = useMemo(() => {
    const rows = new Map();
    (report?.actual_history || []).forEach(row => rows.set(row.date, { date: row.date, actual: row.actual_revenue }));
    (report?.backtest || []).forEach(row => rows.set(row.date, { ...rows.get(row.date), date: row.date, actual: row.actual_revenue, predicted: row.predicted_revenue }));
    (report?.sales_forecast || []).forEach(row => rows.set(row.date, { ...rows.get(row.date), date: row.date, predicted: row.predicted_revenue }));
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [report]);
  const bookingChart = (report?.booking_forecast || []).map(row => ({ date: row.date, predicted: row.predicted_bookings }));
  const wastageChart = (report?.actual_history || []).map(row => ({ date: row.date, actual: row.actual_wastage_units }));
  const evaluation = report?.evaluation?.sales || {};
  const revenueTotal = (report?.sales_forecast || []).reduce((sum, row) => sum + Number(row.predicted_revenue || 0), 0);
  const demandTotal = (report?.product_forecast || []).reduce((sum, row) => sum + Number(row.predicted_quantity || 0), 0);
  const bookingTotal = (report?.booking_forecast || []).reduce((sum, row) => sum + Number(row.predicted_bookings || 0), 0);

  return (
    <main className="min-h-screen bg-cream px-4 py-6 md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 rounded-[26px] bg-espresso p-6 text-white md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <Link to="/admin" className="text-xs font-bold text-gold hover:underline">← Admin dashboard</Link>
            <p className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-gold"><BrainCircuit size={15} /> CAV InsightHub</p>
            <h1 className="mt-2 text-3xl font-black">Machine Learning Forecasts</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/65">Daily least-squares linear regression over recorded sales, product demand, and studio bookings.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-white/80">Forecast horizon (days)
              <input aria-label="Forecast horizon in days" type="number" min="1" max="90" value={horizon} onChange={event => setHorizon(event.target.value)} className="mt-1 block w-28 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white" />
            </label>
            <button type="button" onClick={retrain} disabled={training || loading || Number(horizon) < 1 || Number(horizon) > 90} className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-black text-espresso disabled:opacity-50">
              <RefreshCw size={16} className={training ? 'animate-spin' : ''} /> {training ? 'Training batch…' : 'Generate forecast'}
            </button>
          </div>
        </header>

        <p className="rounded-xl border border-espresso/10 bg-white/70 px-4 py-3 text-xs font-medium text-espresso/65">Assumption: daily calendar-day totals; days without recorded transactions count as zero. Forecast horizon defaults to seven calendar days. Predictions are clipped at zero.</p>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
        {loading && <p role="status" className="rounded-xl bg-white p-5 text-sm font-semibold text-espresso/60">Loading saved forecast records…</p>}
        {!loading && !report && <Card><p className="font-bold text-espresso">No forecast runs saved yet.</p><p className="mt-1 text-sm text-espresso/60">Generate a forecast to create the first controlled training batch.</p></Card>}
        {report && <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Forecast revenue', report.sales_forecast?.length ? money(revenueTotal) : 'Insufficient historical data', <Activity size={17} />],
              ['Product demand', report.product_forecast?.length ? `${demandTotal.toFixed(2)} units` : 'Insufficient historical data', <Boxes size={17} />],
              ['Studio bookings', report.booking_forecast?.length ? `${bookingTotal.toFixed(2)} bookings` : 'Insufficient historical data', <CalendarDays size={17} />],
              ['Forecast status', report.status === 'ready' ? 'Ready' : 'Insufficient historical data', <Activity size={17} />],
              ['Revenue error (MAE)', evaluation.status === 'available' ? money(evaluation.mae) : 'Pending actual results', <BrainCircuit size={17} />],
              ['Revenue RMSE', evaluation.status === 'available' ? money(evaluation.rmse) : 'Pending actual results', <Activity size={17} />],
              ['Forecast period', report.sales_forecast?.length ? `${dateText(report.sales_forecast[0].date)} – ${dateText(report.sales_forecast.at(-1).date)}` : 'No forecast available', <CalendarDays size={17} />],
            ].map(([label, value, icon]) => <Card key={label} className="!p-5"><div className="flex items-center justify-between text-gold-dark">{icon}<span className="text-[10px] font-black uppercase tracking-widest text-espresso/45">{label}</span></div><p className="mt-3 text-lg font-black text-espresso">{value}</p></Card>)}
          </section>
          <Card className="!p-4 text-xs text-espresso/60">
            <div className="flex flex-wrap gap-x-6 gap-y-2"><span>Model: <b>{report.model_version}</b></span><span>Generated: <b>{new Date(report.generated_at).toLocaleString()}</b></span><span>Training: <b>{dateText(report.training_period?.start)} – {dateText(report.training_period?.end)}</b></span><span>Testing: <b>{report.testing_period?.start ? `${dateText(report.testing_period.start)} – ${dateText(report.testing_period.end)}` : 'Pending actual results'}</b></span></div>
            {report.status !== 'ready' && <p className="mt-2 font-bold text-amber-800">Insufficient historical data</p>}
          </Card>
          <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="Chronological test results" subtitle="MAE and RMSE are calculated on the held-out later dates. Metrics remain pending when a series has too little history." className="mb-3" />{Object.keys(report.evaluation || {}).length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-cream text-espresso/60"><tr>{['Series', 'Test dates', 'MAE', 'RMSE', 'Observations'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{Object.entries(report.evaluation).map(([key, result]) => <tr key={key} className="border-t border-espresso/5"><td className="p-3 font-semibold">{key === 'sales' ? 'Revenue (PHP)' : key === 'bookings' ? 'Studio bookings' : `Product ${key.replace('product_', '')} (units)`}</td><td className="p-3">{result.status === 'available' ? `${result.test_count} days` : 'Pending actual results'}</td><td className="p-3">{result.status === 'available' ? Number(result.mae).toFixed(2) : 'Pending actual results'}</td><td className="p-3">{result.status === 'available' ? Number(result.rmse).toFixed(2) : 'Pending actual results'}</td><td className="p-3">{result.status === 'available' ? result.test_count : '—'}</td></tr>)}</tbody></table></div> : <p className="p-4 text-sm font-semibold text-espresso/55">Insufficient historical data</p>}</div></Card>
          <ForecastChart title="Revenue: actual vs predicted" subtitle="Daily values (PHP). Backtest predictions include actuals only for held-out recorded dates." data={salesChart} valueKeys={[[ 'actual', 'Actual revenue', '#2E1A11' ], [ 'predicted', 'Predicted revenue', '#D4AF37' ]]} unit="PHP" />
          <ForecastChart title="Recorded wastage" subtitle="Historical wasted product units, displayed separately from sales and demand." data={wastageChart} valueKeys={[[ 'actual', 'Wasted units', '#B45353' ]]} unit="units" />
          <div className="grid gap-5 xl:grid-cols-2">
            <ForecastChart title="Studio booking demand" subtitle="Predicted non-cancelled bookings per scheduled calendar day." data={bookingChart} valueKeys={[[ 'predicted', 'Predicted bookings', '#A47716' ]]} unit="bookings" />
            <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="Product demand" subtitle="Predicted units per day by product." className="mb-3" />{report.product_forecast?.length ? <div className="max-h-[300px] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-cream text-espresso/60"><tr><th className="p-2">Date</th><th className="p-2">Product</th><th className="p-2 text-right">Units</th></tr></thead><tbody>{report.product_forecast.map((row, index) => <tr key={`${row.date}-${row.product_id}-${index}`} className="border-t border-espresso/5"><td className="p-2">{dateText(row.date)}</td><td className="p-2 font-semibold">{row.product_name}</td><td className="p-2 text-right">{metric(row.predicted_quantity, 'units')}</td></tr>)}</tbody></table></div> : <p className="rounded-xl bg-cream/70 p-5 text-sm font-semibold text-espresso/55">Insufficient historical data</p>}</div></Card>
          </div>
          <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="Inventory recommendations" subtitle="Forecast product demand is translated through saved recipes. Values are suggestions only; stock is not changed." className="mb-3" />{report.recommendations?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-cream text-espresso/60"><tr>{['Type', 'Item', 'Forecast need', 'Available', 'Shortage', 'Suggested replenishment', 'Unit'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{report.recommendations.map(row => <tr key={`${row.type}-${row.item_id}`} className="border-t border-espresso/5"><td className="p-3 capitalize">{row.type}</td><td className="p-3 font-bold">{row.item_name}</td><td className="p-3">{metric(row.forecast_requirement ?? row.forecast_demand, row.type === 'ingredient' ? row.unit : 'units')}</td><td className="p-3">{metric(row.available_stock, row.type === 'ingredient' ? row.unit : 'units')}</td><td className="p-3 font-bold text-red-700">{metric(row.shortage, row.type === 'ingredient' ? row.unit : 'units')}</td><td className="p-3">{metric(row.suggested_replenishment, row.type === 'ingredient' ? row.unit : 'units')}</td><td className="p-3">{row.unit}</td></tr>)}</tbody></table></div> : <p className="rounded-xl bg-cream/70 p-5 text-sm font-semibold text-espresso/55">No recommendations available for this forecast.</p>}</div></Card>
          <Card padding={false} className="rounded-[24px]"><div className="p-5 md:p-6"><CardHeader title="Forecast history" subtitle="Saved predictions, generation time, training/testing periods, and model version." className="mb-3" />{history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-cream text-espresso/60"><tr>{['Generated', 'Horizon', 'Training period', 'Model version', 'Status'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{history.map(run => <tr key={run.id} className="border-t border-espresso/5"><td className="p-3">{new Date(run.generated_at).toLocaleString()}</td><td className="p-3">{run.horizon_days} days</td><td className="p-3">{dateText(run.training_period?.start)} – {dateText(run.training_period?.end)}</td><td className="p-3 font-mono">{run.model_version}</td><td className="p-3">{run.status === 'ready' ? 'Ready' : 'Insufficient historical data'}</td></tr>)}</tbody></table></div> : <p className="p-4 text-sm text-espresso/55">No saved runs.</p>}</div></Card>
          <p className="flex items-center gap-2 pb-4 text-[11px] text-espresso/45"><Boxes size={14} />Future dates show predictions only. Actual values and MAE/RMSE appear after the chronological test window contains recorded results.</p>
        </>}
      </div>
    </main>
  );
}
