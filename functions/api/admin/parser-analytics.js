import { sendJson, supabaseFetch, requireAdmin } from '../../_shared.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    // Get Jobs
    const jobsRes = await supabaseFetch(context.env, '/rest/v1/parse_jobs?select=*&order=created_at.desc');
    const jobs = await jobsRes.json();

    // Get Feedback
    const fbRes = await supabaseFetch(context.env, '/rest/v1/parse_feedback?select=*&order=created_at.desc');
    const feedback = await fbRes.json();
    
    // Calculate metrics
    const total_processed = jobs.length;
    const total_success = jobs.filter(j => j.status === 'saved' || j.status === 'success').length;
    const total_failed = jobs.filter(j => j.status === 'failed').length;
    
    let total_questions = 0;
    let questions_count_jobs = 0;
    
    const errors_map = {};
    const feedback_map = {};

    jobs.forEach(j => {
      if (j.detected_question_count) {
        total_questions += j.detected_question_count;
        questions_count_jobs++;
      }
      if (j.validation_errors && Array.isArray(j.validation_errors)) {
        j.validation_errors.forEach(e => {
          errors_map[e] = (errors_map[e] || 0) + 1;
        });
      }
    });

    feedback.forEach(f => {
      if (f.feedback_type) {
        feedback_map[f.feedback_type] = (feedback_map[f.feedback_type] || 0) + 1;
      }
    });

    const avg_questions = questions_count_jobs > 0 ? Math.round(total_questions / questions_count_jobs) : 0;
    
    // Sort maps
    const top_errors = Object.entries(errors_map).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const top_feedback = Object.entries(feedback_map).sort((a,b) => b[1] - a[1]).slice(0, 5);

    // We can also fetch the parse_results, but to keep payload small, we only return jobs & metrics
    // The admin UI can query specific results if needed, or we just rely on jobs for summary

    return sendJson({
      metrics: {
        total_processed,
        total_success,
        total_failed,
        avg_questions,
        top_errors,
        top_feedback
      },
      jobs: jobs.slice(0, 50), // Last 50 jobs
      feedback: feedback.slice(0, 20) // Last 20 feedback
    });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
