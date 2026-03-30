/**
 * Notification Service for Uptime Pulse v2
 *
 * Handles alert creation, status updates, and optional webhook delivery.
 * Imported by server.js — receives Supabase client as parameter.
 *
 * Follows the shared interface spec in docs/plans/2026-03-30-incident-pipeline.md
 */

module.exports = function createNotificationService(supabase) {
  /**
   * Convert milliseconds to a human-readable duration string.
   * Examples: "5m 30s", "2h 15m", "3d 4h"
   */
  function formatDuration(ms) {
    if (ms == null || ms < 0) return '0s';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Generate a human-readable message based on the incident event action.
   */
  function generateMessage(action, incident, siteName) {
    const time = new Date(incident.started_at).toLocaleTimeString();

    switch (action) {
      case 'created':
        return `${siteName} is DOWN — incident detected at ${time}`;
      case 'confirmed':
        return `${siteName} outage CONFIRMED — ${incident.consecutive_failures} consecutive failures, severity: ${incident.severity}`;
      case 'resolved': {
        const duration = formatDuration(incident.duration_ms);
        return `${siteName} is back UP — incident resolved after ${duration}`;
      }
      case 'updated':
        return `${siteName} — incident updated, ${incident.consecutive_failures} failures`;
      default:
        return `${siteName} — unknown action: ${action}`;
    }
  }

  /**
   * Map event action to status_update type.
   * 'updated' does not create a status_update, so returns null.
   */
  function actionToUpdateType(action) {
    const map = {
      created: 'detected',
      confirmed: 'confirmed',
      resolved: 'resolved',
    };
    return map[action] || null;
  }

  /**
   * Send a notification for an incident event.
   *
   * @param {Object} incidentEvent - { action, incident, site_name, site_url }
   * @returns {Object[]} Array of notification records created
   */
  async function sendNotification(incidentEvent) {
    const { action, incident, site_name, site_url } = incidentEvent;
    const notifications = [];

    try {
      const message = generateMessage(action, incident, site_name);
      const updateType = actionToUpdateType(action);
      const now = new Date().toISOString();

      // Note: status_updates are created by incidents.js (Incident Manager)
      // to avoid double-inserts. This service only handles notifications.

      // Build the notification payload
      const payload = {
        type: updateType || action,
        site_name,
        site_url,
        severity: incident.severity,
        message,
        timestamp: now,
      };

      // Create the 'log' channel notification (always)
      const { data: logNotification, error: logError } = await supabase
        .from('notifications')
        .insert({
          incident_id: incident.id,
          channel: 'log',
          payload,
          status: 'sent',
          sent_at: now,
        })
        .select()
        .single();

      if (logError) {
        console.error('[notifications] Failed to insert log notification:', logError.message);
      } else {
        notifications.push(logNotification);
      }

      console.log(`[notifications] ${message}`);

      // Optional webhook delivery
      if (process.env.WEBHOOK_URL) {
        let webhookStatus = 'sent';
        let webhookError = null;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(process.env.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!response.ok) {
            webhookStatus = 'failed';
            webhookError = `HTTP ${response.status}`;
          }
        } catch (err) {
          webhookStatus = 'failed';
          webhookError = err.message;
          console.error('[notifications] Webhook delivery failed:', err.message);
        }

        const { data: webhookNotification, error: whError } = await supabase
          .from('notifications')
          .insert({
            incident_id: incident.id,
            channel: 'webhook',
            payload,
            status: webhookStatus,
            sent_at: webhookStatus === 'sent' ? now : null,
            error: webhookError,
          })
          .select()
          .single();

        if (whError) {
          console.error('[notifications] Failed to insert webhook notification:', whError.message);
        } else {
          notifications.push(webhookNotification);
        }
      }
    } catch (err) {
      console.error('[notifications] Unexpected error in sendNotification:', err.message);
    }

    return notifications;
  }

  /**
   * Get all notifications for a given incident.
   *
   * @param {string} incidentId - UUID of the incident
   * @returns {Object[]} Array of notification records, newest first
   */
  async function getNotificationsForIncident(incidentId) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('incident_id', incidentId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[notifications] Failed to query notifications:', error.message);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('[notifications] Unexpected error in getNotificationsForIncident:', err.message);
      return [];
    }
  }

  return { sendNotification, getNotificationsForIncident, formatDuration };
};
