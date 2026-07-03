import { requireAdmin } from '../../_shared/auth.js';
import { sendJson } from '../../_shared/response.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    return sendJson({
      ok: true,
      user: {
        id: auth.user.id,
        email: auth.user.email
      },
      profile: auth.profile
    });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
