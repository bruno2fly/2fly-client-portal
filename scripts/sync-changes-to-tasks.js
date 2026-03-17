/**
 * One-time script: Sync existing client change requests to production tasks.
 *
 * Reads the portal state for a given client, finds approvals with status "changes"
 * or "copy_changes", and updates the linked production tasks to "changes_requested".
 *
 * Usage (run on the server via railway run, or locally pointed at production):
 *   API_BASE=https://api.2flyflow.com CLIENT_TOKEN=<token> node scripts/sync-changes-to-tasks.js
 *
 * Or run directly on the server:
 *   node -e "require('./scripts/sync-changes-to-tasks.js')"
 */

const API_BASE = process.env.API_BASE || 'https://api.2flyflow.com';
const CLIENT_TOKEN = process.env.CLIENT_TOKEN || '';

async function main() {
  if (!CLIENT_TOKEN) {
    console.log('No CLIENT_TOKEN provided. Trying direct DB approach...');
    await directDBApproach();
    return;
  }

  // API approach — uses the new /request-changes endpoint
  console.log('Fetching portal state from', API_BASE);

  const stateRes = await fetch(API_BASE + '/api/client/portal-state', {
    headers: { 'Authorization': 'Bearer ' + CLIENT_TOKEN }
  });
  const stateData = await stateRes.json();
  if (!stateData.success) {
    console.error('Failed to fetch portal state:', stateData);
    return;
  }

  const approvals = stateData.data.approvals || [];
  const changesApprovals = approvals.filter(a =>
    a.status === 'changes' || a.status === 'copy_changes'
  );

  console.log('Found', changesApprovals.length, 'approvals with change requests');

  for (const approval of changesApprovals) {
    const latestNote = approval.change_notes && approval.change_notes.length
      ? approval.change_notes[approval.change_notes.length - 1].note
      : 'Change requested by client';

    console.log('  Processing:', approval.title, '- Note:', latestNote.slice(0, 60));

    const res = await fetch(API_BASE + '/api/client/request-changes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CLIENT_TOKEN
      },
      body: JSON.stringify({ approvalId: approval.id, note: latestNote })
    });
    const result = await res.json();
    console.log('    Result:', JSON.stringify(result));
  }

  console.log('Done!');
}

async function directDBApproach() {
  // Direct DB approach — for running on the server itself
  try {
    const path = require('path');
    const fs = require('fs');

    // Try to find the data directory
    const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
      : path.join(__dirname, '..', 'server', 'data');

    console.log('Using data directory:', dataDir);

    const portalStatePath = path.join(dataDir, 'portal-state.json');
    const tasksPath = path.join(dataDir, 'production-tasks.json');

    if (!fs.existsSync(portalStatePath) || !fs.existsSync(tasksPath)) {
      console.error('Data files not found. Make sure you run this from the project root or set RAILWAY_VOLUME_MOUNT_PATH.');
      return;
    }

    const portalStates = JSON.parse(fs.readFileSync(portalStatePath, 'utf8'));
    const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

    let updated = 0;

    for (const [key, state] of Object.entries(portalStates)) {
      const approvals = state.approvals || [];
      const changesApprovals = approvals.filter(a =>
        a.status === 'changes' || a.status === 'copy_changes'
      );

      if (changesApprovals.length === 0) continue;
      console.log('Client key:', key, '- Found', changesApprovals.length, 'change requests');

      for (const approval of changesApprovals) {
        const latestNote = approval.change_notes && approval.change_notes.length
          ? approval.change_notes[approval.change_notes.length - 1].note
          : 'Change requested by client';

        // Find linked production task
        const linkedTask = tasks.find(t =>
          (t.approvalId === approval.id || t.contentId === approval.id)
        );

        if (!linkedTask) {
          console.log('  No linked task for:', approval.title, '(ID:', approval.id + ')');
          continue;
        }

        const changeable = ['review', 'in_progress', 'approved', 'ready_to_post', 'assigned'];
        if (changeable.includes(linkedTask.status)) {
          console.log('  Updating task:', linkedTask.id, 'for approval:', approval.title);
          console.log('    Previous status:', linkedTask.status, '→ changes_requested');
          console.log('    Note:', latestNote.slice(0, 80));

          linkedTask.status = 'changes_requested';
          linkedTask.reviewNotes = 'Client change request: ' + latestNote;
          linkedTask.updatedAt = new Date().toISOString();
          updated++;
        } else {
          console.log('  Task', linkedTask.id, 'already in status:', linkedTask.status, '- skipping');
        }
      }
    }

    if (updated > 0) {
      fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
      console.log('\nSaved', updated, 'task updates to', tasksPath);
    } else {
      console.log('\nNo tasks needed updating.');
    }
  } catch (e) {
    console.error('Direct DB approach failed:', e.message);
  }
}

main().catch(console.error);
