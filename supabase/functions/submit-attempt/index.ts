/**
 * submit-attempt Edge Function.
 *
 * Records a test attempt, enforces the retest gate, issues a certificate on a
 * pass, consumes a granted retest, and writes the score notification — all
 * server-side. The gate is re-checked here rather than trusted from the UI: a
 * locked test that only LOOKS locked is decorative.
 *
 * The gate, once: one free first attempt; a free renewal once a pass is held;
 * after a failure the test locks and only a manager's grant opens exactly one
 * attempt, consumed whether it is passed or failed.
 */

import { serviceClient, staffFromToken, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

/** attempt date + validity months, clamping a day-of-month overflow. */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  const target = d.getMonth() + months
  d.setMonth(target)
  if (d.getMonth() !== ((target % 12) + 12) % 12) d.setDate(0)
  return d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token ?? '') || bearer(req)
    const testId = String(body.test_id ?? '')
    const answers: Array<number | null> = Array.isArray(body.answers) ? body.answers : []
    const language = typeof body.language === 'string' ? body.language : 'en'

    const staff = await staffFromToken(admin, token)
    if (!staff) return json({ error: 'Your session has ended. Please sign in again.' }, 401)

    const { data: test } = await admin.from('tests').select('*').eq('id', testId).maybeSingle()
    if (!test) return json({ error: 'That test no longer exists.' }, 404)

    const { data: assigned } = await admin
      .from('test_assignments')
      .select('id')
      .eq('test_id', testId)
      .eq('staff_id', staff.id)
      .maybeSingle()
    if (!assigned) return json({ error: 'This test has not been assigned to you.' }, 403)

    // The gate.
    const { data: history } = await admin
      .from('attempts')
      .select('id, passed, attempted_at')
      .eq('staff_id', staff.id)
      .eq('test_id', testId)
      .order('attempted_at', { ascending: false })
    const last = history?.[0]
    const { data: grant } = await admin
      .from('retest_grants')
      .select('*')
      .eq('staff_id', staff.id)
      .eq('test_id', testId)
      .eq('used', false)
      .maybeSingle()

    let reason: 'first_attempt' | 'renewal' | 'granted' | null
    if (!history || history.length === 0) reason = 'first_attempt'
    else if (last?.passed) reason = 'renewal'
    else if (grant) reason = 'granted'
    else reason = null
    if (!reason) {
      return json({ error: 'This test is locked after your last attempt. Your manager must approve a retest.' }, 403)
    }

    // Score by option position (identical in every language the test offers).
    const { data: questions } = await admin
      .from('questions')
      .select('correct_index, position')
      .eq('test_id', testId)
      .order('position')
    let score = 0
    ;(questions ?? []).forEach((q, i) => {
      if (answers[i] === q.correct_index) score++
    })
    const total = (questions ?? []).length
    const percentage = total === 0 ? 0 : Math.round((score / total) * 100)
    const passed = percentage >= (test.pass_mark as number)

    const { data: attempt, error: attErr } = await admin
      .from('attempts')
      .insert({ staff_id: staff.id, test_id: testId, score, total, percentage, passed, language })
      .select('*')
      .single()
    if (attErr) return json({ error: attErr.message }, 500)

    if (reason === 'granted' && grant) {
      await admin.from('retest_grants').update({ used: true }).eq('id', grant.id)
    }

    let certification = null
    if (passed) {
      const issued = new Date()
      const expires = addMonths(issued, test.validity_months as number)
      const { data: cert } = await admin
        .from('certifications')
        .insert({
          staff_id: staff.id,
          test_id: testId,
          issued_at: issued.toISOString(),
          expires_at: expires.toISOString(),
          source_attempt_id: attempt.id,
        })
        .select('*')
        .single()
      certification = cert
    }

    await admin.from('notifications').insert({
      staff_id: staff.id,
      kind: 'score_recorded',
      text: passed
        ? `You passed ${test.title} with ${percentage}%. Your certificate is valid for ${test.validity_months} months.`
        : `You scored ${percentage}% on ${test.title}, below the ${test.pass_mark}% pass mark. Your manager must approve a retest.`,
    })

    return json({ attempt, certification })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not record your attempt.' }, 500)
  }
})
