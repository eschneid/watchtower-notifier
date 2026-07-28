#!/usr/bin/env node
/**
 * notify-social.js
 *
 * Runs every ~15 minutes via GitHub Actions (in this public runner repo — kept
 * public so Actions minutes are unlimited; contains no secrets).
 * Drains the `notificationQueue` collection — one doc per like/comment a friend
 * made on someone's activity — and sends an FCM push to each recipient.
 *
 * Queue docs (written client-side by the app's src/services/social.js
 * enqueueNotification in the private watchtower-mobile repo):
 *   { recipientId, actorId, actorName, type: "like"|"comment",
 *     showTitle, tmdbId, showType, commentText, sent: false, createdAt }
 *
 * Multiple pending items for the same recipient are collapsed into one push so a
 * flurry of likes doesn't spam. Processed docs are deleted on success; docs left
 * behind (transient failure) are retried next run.
 */

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  console.log("🔔 Draining social notification queue...");

  const snap = await db.collection("notificationQueue").where("sent", "==", false).limit(500).get();
  if (snap.empty) {
    console.log("   Queue empty. Nothing to send.");
    process.exit(0);
  }
  console.log(`   ${snap.size} pending item(s).`);

  // Group pending items by recipient so we send at most one push per person.
  const byRecipient = new Map();
  for (const doc of snap.docs) {
    const item = { id: doc.id, ref: doc.ref, ...doc.data() };
    if (!byRecipient.has(item.recipientId)) byRecipient.set(item.recipientId, []);
    byRecipient.get(item.recipientId).push(item);
  }

  let sent = 0;

  for (const [recipientId, items] of byRecipient) {
    // Look up the recipient's device tokens (array, with legacy single-token fallback).
    const userSnap = await db.collection("users").doc(recipientId).get();
    const profile = userSnap.data() || {};
    const rawTokens = profile.fcmTokens;
    const fcmTokens = Array.isArray(rawTokens) && rawTokens.length > 0
      ? rawTokens
      : profile.fcmToken ? [profile.fcmToken] : [];

    // No tokens — recipient can't be reached; drop the items so they don't pile up.
    if (fcmTokens.length === 0) {
      await deleteAll(items);
      continue;
    }

    const { title, body, singleShow } = buildMessage(items);

    let delivered = false;
    for (const token of fcmTokens) {
      try {
        await admin.messaging().send({
          token,
          notification: { title, body },
          android: { priority: "high", notification: { channelId: "default" } },
          apns: { payload: { aps: { sound: "default" } } },
          ...(singleShow?.tmdbId && {
            data: { tmdbId: String(singleShow.tmdbId), type: singleShow.showType || "tv" },
          }),
        });
        delivered = true;
      } catch (e) {
        if (e.code === "messaging/registration-token-not-registered") {
          await db.collection("users").doc(recipientId).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
          });
          console.log(`  🗑 Removed stale token for ${recipientId}`);
        } else {
          console.warn(`  ✗ FCM failed for ${recipientId}: ${e.message}`);
        }
      }
    }

    if (delivered) {
      console.log(`  ✓ ${recipientId} — ${items.length} interaction(s)`);
      sent++;
      await deleteAll(items);
    } else {
      // All tokens were stale/unreachable. Drop the items to avoid infinite retry.
      await deleteAll(items);
    }
  }

  console.log(`\n✅ Done. Notified ${sent} recipient(s).\n`);
  process.exit(0);
}

// Collapse a recipient's pending items into a single title/body.
function buildMessage(items) {
  if (items.length === 1) {
    const it = items[0];
    const show = it.showTitle ? ` on ${it.showTitle}` : "";
    if (it.type === "comment") {
      return {
        title: `💬 ${it.actorName} commented`,
        body: it.commentText ? `"${it.commentText}"` : `${it.actorName} commented${show}.`,
        singleShow: it,
      };
    }
    return {
      title: `❤️ ${it.actorName} liked your activity`,
      body: it.showTitle ? it.showTitle : "Tap to see.",
      singleShow: it,
    };
  }

  // Multiple interactions — summarize. Deep-link only when they all target one show.
  const actors = [...new Set(items.map(i => i.actorName))];
  const actorLabel = actors.length === 1
    ? actors[0]
    : actors.length === 2
      ? `${actors[0]} and ${actors[1]}`
      : `${actors[0]} and ${actors.length - 1} others`;

  const tmdbIds = [...new Set(items.map(i => i.tmdbId).filter(Boolean))];
  const singleShow = tmdbIds.length === 1 ? items.find(i => i.tmdbId === tmdbIds[0]) : null;

  return {
    title: "👥 New activity on Watchtower",
    body: `${actorLabel} interacted with your activity.`,
    singleShow,
  };
}

async function deleteAll(items) {
  const batch = db.batch();
  items.forEach(it => batch.delete(it.ref));
  await batch.commit();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});
