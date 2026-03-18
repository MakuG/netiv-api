const OBJ_MAP = {
  mensajes:      { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS',       billing_event: 'IMPRESSIONS', destination_type: 'WHATSAPP' },
  conversiones:  { objective: 'OUTCOME_SALES',      optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS' },
  trafico:       { objective: 'OUTCOME_TRAFFIC',    optimization_goal: 'LINK_CLICKS',         billing_event: 'IMPRESSIONS' },
  leads:         { objective: 'OUTCOME_LEADS',      optimization_goal: 'LEAD_GENERATION',     billing_event: 'IMPRESSIONS' },
  reconocimiento:{ objective: 'OUTCOME_AWARENESS',  optimization_goal: 'REACH',               billing_event: 'IMPRESSIONS' },
  engagement:    { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'POST_ENGAGEMENT',     billing_event: 'IMPRESSIONS' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { access_token, account_id, campaign, obj_key } = req.body;
  if (!access_token || !account_id || !campaign) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
  }

  const accountId = account_id.startsWith('act_') ? account_id : `act_${account_id}`;
  const base = 'https://graph.facebook.com/v19.0';
  const objConfig = OBJ_MAP[obj_key] || OBJ_MAP.mensajes;

  // Daily budget in centavos (Meta ARS = centavos)
  const dailyBudgetTotal = Math.round((campaign.total_budget_ars / (campaign.duration_days || 30)) * 100);

  try {
    // 1. Create Campaign
    const campRes = await fetch(`${base}/${accountId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaign.campaign_name,
        objective: objConfig.objective,
        status: 'PAUSED',
        special_ad_categories: [],
        ...(objConfig.destination_type ? { destination_type: objConfig.destination_type } : {}),
        access_token
      })
    });
    const campData = await campRes.json();
    if (campData.error) throw new Error(`Campaña: ${campData.error.message} | code: ${campData.error.code} | subcode: ${campData.error.error_subcode} | type: ${campData.error.type}`);
    const campaignId = campData.id;

    // 2. Create Ad Sets
    const adsetResults = [];
    for (const adset of (campaign.adsets || [])) {
      // Resolve interest IDs
      const interests = [];
      for (const name of (adset.interest_names || []).slice(0, 5)) {
        try {
          const sr = await fetch(`${base}/search?type=adinterest&q=${encodeURIComponent(name)}&limit=1&locale=es_LA&access_token=${access_token}`);
          const sd = await sr.json();
          if (sd.data?.[0]) interests.push({ id: sd.data[0].id, name: sd.data[0].name });
        } catch {}
      }

      const targeting = {
        age_min: adset.age_min || 18,
        age_max: adset.age_max || 65,
        geo_locations: { countries: ['AR'], location_types: ['home', 'recent'] },
      };
      if (adset.genders?.length) targeting.genders = adset.genders;
      if (interests.length) targeting.flexible_spec = [{ interests }];

      const adsetBudget = Math.round(dailyBudgetTotal * ((adset.budget_percent || 33) / 100));

      const adsetRes = await fetch(`${base}/${accountId}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: adset.name,
          campaign_id: campaignId,
          daily_budget: adsetBudget,
          billing_event: objConfig.billing_event,
          optimization_goal: objConfig.optimization_goal,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          targeting,
          status: 'PAUSED',
          access_token
        })
      });
      const adsetData = await adsetRes.json();
      adsetResults.push({
        name: adset.name,
        id: adsetData.id,
        budget_ars: Math.round(adsetBudget / 100),
        interests_resolved: interests.map(i => i.name),
        notes: adset.notes,
        error: adsetData.error?.message || null
      });
    }

    const acctId = account_id.replace('act_', '');
    return res.status(200).json({
      success: true,
      campaign_id: campaignId,
      campaign_name: campaign.campaign_name,
      adsets: adsetResults,
      meta_url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acctId}&selected_campaign_ids=${campaignId}`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
