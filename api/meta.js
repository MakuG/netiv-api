export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { access_token, account_id, date_preset = 'last_30d' } = req.body;

  if (!access_token || !account_id) {
    return res.status(400).json({ error: 'Faltan parámetros: access_token y account_id son obligatorios' });
  }

  const accountId = account_id.startsWith('act_') ? account_id : `act_${account_id}`;
  const base = 'https://graph.facebook.com/v19.0';
  const token = `access_token=${access_token}`;

  try {
    const [campaignsRes, insightsRes] = await Promise.all([
      fetch(`${base}/${accountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&${token}&limit=25`),
      fetch(`${base}/${accountId}/insights?fields=impressions,reach,clicks,spend,cpc,ctr,cpp,actions&date_preset=${date_preset}&${token}`)
    ]);

    const campaignsData = await campaignsRes.json();
    const insightsData  = await insightsRes.json();

    if (campaignsData.error) {
      return res.status(400).json({ error: `Meta API: ${campaignsData.error.message}` });
    }

    const campaigns = campaignsData.data || [];
    const insights  = insightsData.data?.[0] || null;

    const dateLabels = {
      last_7d: 'Últimos 7 días', last_14d: 'Últimos 14 días',
      last_30d: 'Últimos 30 días', last_month: 'Mes pasado', this_month: 'Este mes'
    };

    const fmt = n => n ? parseFloat(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—';

    let summary = `=== MÉTRICAS DE META ADS ===\nPeríodo: ${dateLabels[date_preset] || date_preset}\n\n`;

    if (insights) {
      summary += `📊 RESUMEN GENERAL:\n`;
      summary += `- Alcance: ${fmt(insights.reach)}\n`;
      summary += `- Impresiones: ${fmt(insights.impressions)}\n`;
      summary += `- Clics: ${fmt(insights.clicks)}\n`;
      summary += `- Gasto total: $${fmt(insights.spend)} USD\n`;
      summary += `- CPC (costo por clic): $${fmt(insights.cpc)} USD\n`;
      summary += `- CTR: ${fmt(insights.ctr)}%\n`;
      summary += `- CPM: $${fmt(insights.cpp)} USD\n\n`;

      if (insights.actions?.length) {
        summary += `🎯 ACCIONES Y CONVERSIONES:\n`;
        insights.actions.forEach(a => {
          summary += `- ${a.action_type.replace(/_/g, ' ')}: ${fmt(a.value)}\n`;
        });
        summary += '\n';
      }
    } else {
      summary += `📊 Sin datos de métricas para este período.\n\n`;
    }

    if (campaigns.length) {
      const active = campaigns.filter(c => c.status === 'ACTIVE').length;
      const paused = campaigns.filter(c => c.status === 'PAUSED').length;
      summary += `📣 CAMPAÑAS (${campaigns.length} total — ${active} activas, ${paused} pausadas):\n`;
      campaigns.forEach((c, i) => {
        const budget = c.daily_budget
          ? `Presupuesto diario: $${(c.daily_budget / 100).toFixed(2)}`
          : c.lifetime_budget
          ? `Presupuesto total: $${(c.lifetime_budget / 100).toFixed(2)}`
          : 'Sin presupuesto';
        summary += `${i + 1}. "${c.name}" — ${c.status === 'ACTIVE' ? '🟢 Activa' : '🟡 Pausada'} — Objetivo: ${c.objective} — ${budget}\n`;
      });
    } else {
      summary += `📣 No se encontraron campañas en esta cuenta.\n`;
    }

    return res.status(200).json({ campaigns, insights, summary, period: date_preset });
  } catch (err) {
    return res.status(500).json({ error: `Error del servidor: ${err.message}` });
  }
}
