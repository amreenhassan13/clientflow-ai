<?php
/**
 * Plugin Name:       ClientFlow Lead Capture
 * Description:       Quote form shortcode that sends enquiries to ClientFlow AI over HMAC-signed requests, with a retry outbox for outages.
 * Version:           1.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * License:           GPL-2.0-or-later
 * Text Domain:       clientflow-leads
 *
 * Configure in wp-config.php (never in the database):
 *   define('CLIENTFLOW_API_URL', 'https://your-app.vercel.app');
 *   define('CLIENTFLOW_WEBHOOK_SECRET', 'same value as WORDPRESS_WEBHOOK_SECRET on Vercel');
 */

if (!defined('ABSPATH')) {
    exit;
}

const CLIENTFLOW_VERSION      = '1.1.0';
const CLIENTFLOW_DB_VERSION   = '1';
const CLIENTFLOW_CRON_HOOK    = 'clientflow_retry_outbox';
const CLIENTFLOW_MAX_ATTEMPTS = 20;
const CLIENTFLOW_SERVICES     = ['Residential cleaning', 'Commercial cleaning', 'Deep cleaning', 'Move-out cleaning', 'Other'];

/* -------------------------------------------------------------------------
 * Setup
 * ---------------------------------------------------------------------- */

function clientflow_outbox_table(): string
{
    global $wpdb;
    return $wpdb->prefix . 'clientflow_outbox';
}

function clientflow_is_configured(): bool
{
    return defined('CLIENTFLOW_API_URL') && defined('CLIENTFLOW_WEBHOOK_SECRET')
        && CLIENTFLOW_API_URL !== '' && strlen((string) CLIENTFLOW_WEBHOOK_SECRET) >= 16;
}

function clientflow_activate(): void
{
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $table   = clientflow_outbox_table();
    $charset = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE {$table} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        idempotency_key char(36) NOT NULL,
        payload longtext NOT NULL,
        attempts smallint(5) unsigned NOT NULL DEFAULT 0,
        next_attempt_at datetime NOT NULL,
        last_error varchar(255) NOT NULL DEFAULT '',
        created_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY idempotency_key (idempotency_key),
        KEY next_attempt_at (next_attempt_at)
    ) {$charset};");
    update_option('clientflow_db_version', CLIENTFLOW_DB_VERSION, false);
    if (!wp_next_scheduled(CLIENTFLOW_CRON_HOOK)) {
        wp_schedule_event(time() + 300, 'clientflow_15min', CLIENTFLOW_CRON_HOOK);
    }
}

function clientflow_deactivate(): void
{
    wp_clear_scheduled_hook(CLIENTFLOW_CRON_HOOK);
}

register_activation_hook(__FILE__, 'clientflow_activate');
register_deactivation_hook(__FILE__, 'clientflow_deactivate');

add_filter('cron_schedules', function (array $schedules): array {
    $schedules['clientflow_15min'] = ['interval' => 15 * MINUTE_IN_SECONDS, 'display' => 'Every 15 minutes (ClientFlow)'];
    return $schedules;
});

/* -------------------------------------------------------------------------
 * Delivery to ClientFlow
 * ---------------------------------------------------------------------- */

/** HMAC-SHA256 over "<timestamp>.<body>". Must match lib/signing.ts. */
function clientflow_sign(string $timestamp, string $body): string
{
    return hash_hmac('sha256', $timestamp . '.' . $body, (string) CLIENTFLOW_WEBHOOK_SECRET);
}

/**
 * Sends one signed payload. Returns 'ok', 'retry' (outage, rate limit,
 * misconfiguration) or 'invalid' (ClientFlow rejected the data itself).
 *
 * @return array{0:string,1:string} [result, error message]
 */
function clientflow_deliver(string $json): array
{
    $timestamp = (string) time();
    $response  = wp_remote_post(rtrim((string) CLIENTFLOW_API_URL, '/') . '/api/webhooks/wordpress', [
        'timeout' => 10,
        'headers' => [
            'Content-Type'           => 'application/json',
            'X-Clientflow-Timestamp' => $timestamp,
            'X-Clientflow-Signature' => clientflow_sign($timestamp, $json),
        ],
        'body'    => $json,
    ]);

    if (is_wp_error($response)) {
        return ['retry', substr($response->get_error_message(), 0, 250)];
    }
    $code = (int) wp_remote_retrieve_response_code($response);
    if ($code >= 200 && $code < 300) {
        return ['ok', ''];
    }
    if ($code === 400 || $code === 413) {
        return ['invalid', 'Rejected by ClientFlow (HTTP ' . $code . ')'];
    }
    // 401 usually means the shared secret differs; keep the lead and retry once fixed.
    return ['retry', 'HTTP ' . $code];
}

function clientflow_enqueue(string $key, string $json, string $error): void
{
    global $wpdb;
    $now = current_time('mysql', true);
    $wpdb->query($wpdb->prepare(
        'INSERT IGNORE INTO ' . clientflow_outbox_table() . ' (idempotency_key, payload, attempts, next_attempt_at, last_error, created_at)
         VALUES (%s, %s, 1, DATE_ADD(%s, INTERVAL 5 MINUTE), %s, %s)',
        $key, $json, $now, $error, $now
    ));
}

/** WP-Cron task: re-sends queued leads with exponential backoff. */
function clientflow_retry_outbox(): int
{
    global $wpdb;
    if (!clientflow_is_configured()) {
        return 0;
    }
    $table = clientflow_outbox_table();
    $rows  = $wpdb->get_results($wpdb->prepare(
        "SELECT id, payload, attempts FROM {$table} WHERE attempts < %d AND next_attempt_at <= %s ORDER BY id LIMIT 25",
        CLIENTFLOW_MAX_ATTEMPTS,
        current_time('mysql', true)
    ));
    $sent = 0;
    foreach ((array) $rows as $row) {
        [$result, $error] = clientflow_deliver($row->payload);
        if ($result === 'ok') {
            $wpdb->delete($table, ['id' => $row->id], ['%d']);
            $sent++;
            continue;
        }
        $attempts = (int) $row->attempts + 1;
        $minutes  = min(24 * 60, 5 * (2 ** min($attempts, 9)));
        $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET attempts = %d, last_error = %s, next_attempt_at = DATE_ADD(%s, INTERVAL %d MINUTE) WHERE id = %d",
            $result === 'invalid' ? CLIENTFLOW_MAX_ATTEMPTS : $attempts,
            $error,
            current_time('mysql', true),
            $minutes,
            $row->id
        ));
    }
    return $sent;
}
add_action(CLIENTFLOW_CRON_HOOK, 'clientflow_retry_outbox');

/* -------------------------------------------------------------------------
 * Form
 * ---------------------------------------------------------------------- */

function clientflow_redirect(string $status): void
{
    $back = wp_get_referer() ?: home_url('/');
    wp_safe_redirect(add_query_arg('clientflow', $status, remove_query_arg('clientflow', $back)) . '#clientflow-form');
    exit;
}

/** @return array<string,mixed>|null Sanitised payload, or null when invalid. */
function clientflow_payload_from_post(array $post): ?array
{
    $service = sanitize_text_field(wp_unslash($post['cf_service'] ?? 'Other'));
    $data    = [
        'full_name'       => sanitize_text_field(wp_unslash($post['cf_name'] ?? '')),
        'email'           => sanitize_email(wp_unslash($post['cf_email'] ?? '')),
        'phone'           => sanitize_text_field(wp_unslash($post['cf_phone'] ?? '')),
        'service'         => in_array($service, CLIENTFLOW_SERVICES, true) ? $service : 'Other',
        'notes'           => sanitize_textarea_field(wp_unslash($post['cf_notes'] ?? '')),
        'sms_consent'     => !empty($post['cf_consent']),
        'source'          => 'wordpress',
        'idempotency_key' => wp_generate_uuid4(),
    ];
    $length = function_exists('mb_strlen') ? mb_strlen($data['full_name']) : strlen($data['full_name']);
    if ($length < 2 || $length > 120 || !is_email($data['email']) || strlen($data['notes']) > 1600 || strlen($data['phone']) > 35) {
        return null;
    }
    return $data;
}

add_action('template_redirect', function (): void {
    if (empty($_POST['cf_submit'])) {
        return;
    }
    $nonce = isset($_POST['clientflow_nonce']) ? sanitize_text_field(wp_unslash($_POST['clientflow_nonce'])) : '';
    if (!wp_verify_nonce($nonce, 'clientflow_submit')) {
        clientflow_redirect('expired');
    }
    if (!empty($_POST['cf_website'])) {
        clientflow_redirect('received'); // honeypot: pretend success
    }
    if (!clientflow_is_configured()) {
        clientflow_redirect('unavailable');
    }
    $data = clientflow_payload_from_post($_POST);
    if ($data === null) {
        clientflow_redirect('invalid');
    }

    $json = wp_json_encode($data);
    [$result, $error] = clientflow_deliver($json);
    if ($result === 'ok') {
        clientflow_redirect('received');
    }
    if ($result === 'invalid') {
        clientflow_redirect('invalid');
    }
    // ClientFlow is unreachable: keep the lead locally and retry in the background.
    clientflow_enqueue($data['idempotency_key'], $json, $error);
    error_log('ClientFlow: lead queued for retry (' . $error . ')');
    clientflow_redirect('received');
});

add_shortcode('clientflow_quote', function (): string {
    $status   = isset($_GET['clientflow']) ? sanitize_key(wp_unslash($_GET['clientflow'])) : '';
    $messages = [
        'received'    => ['ok', 'Thanks! Your enquiry was received. We will be in touch shortly.'],
        'invalid'     => ['error', 'Please enter your name and a valid email address, then try again.'],
        'expired'     => ['error', 'The form expired. Please submit it again.'],
        'unavailable' => ['error', 'Online enquiries are temporarily unavailable. Please call us instead.'],
    ];
    ob_start();
    ?>
    <style>
      .clientflow-form{display:grid;gap:14px;max-width:560px}
      .clientflow-form label{display:grid;gap:6px;font-weight:600}
      .clientflow-form input,.clientflow-form select,.clientflow-form textarea{padding:10px 12px;border:1px solid #cfd8df;border-radius:8px;font:inherit}
      .clientflow-form .cf-consent{display:flex;gap:10px;align-items:flex-start;font-weight:400}
      .clientflow-form .cf-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
      .clientflow-form button{padding:12px 18px;border:0;border-radius:8px;background:#1b3549;color:#fff;font-weight:700;cursor:pointer}
      .cf-notice{padding:12px 14px;border-radius:8px;margin-bottom:14px}
      .cf-notice.ok{background:#e8f8f1;color:#13654f}.cf-notice.error{background:#fff1f2;color:#9b2f3d}
    </style>
    <div id="clientflow-form">
      <?php if (isset($messages[$status])) : ?>
        <p class="cf-notice <?php echo esc_attr($messages[$status][0]); ?>" role="status"><?php echo esc_html($messages[$status][1]); ?></p>
      <?php endif; ?>
      <form method="post" class="clientflow-form">
        <?php wp_nonce_field('clientflow_submit', 'clientflow_nonce'); ?>
        <label>Full name <input required name="cf_name" minlength="2" maxlength="120" autocomplete="name"></label>
        <label>Email <input type="email" required name="cf_email" maxlength="254" autocomplete="email"></label>
        <label>Mobile (with country code) <input type="tel" name="cf_phone" maxlength="35" placeholder="+61 400 000 000" autocomplete="tel"></label>
        <label>Service
          <select name="cf_service">
            <?php foreach (CLIENTFLOW_SERVICES as $service) : ?>
              <option><?php echo esc_html($service); ?></option>
            <?php endforeach; ?>
          </select>
        </label>
        <label>Message <textarea name="cf_notes" maxlength="1600" rows="4"></textarea></label>
        <label class="cf-consent"><input type="checkbox" name="cf_consent" value="1"> Text me updates about this enquiry. Reply STOP to opt out.</label>
        <div class="cf-hp" aria-hidden="true"><label>Leave this empty <input name="cf_website" tabindex="-1" autocomplete="off"></label></div>
        <button name="cf_submit" value="1" type="submit">Get my quote</button>
      </form>
    </div>
    <?php
    return (string) ob_get_clean();
});

/* -------------------------------------------------------------------------
 * Admin: status page and notices
 * ---------------------------------------------------------------------- */

function clientflow_outbox_counts(): array
{
    global $wpdb;
    $table = clientflow_outbox_table();
    $row   = $wpdb->get_row($wpdb->prepare(
        "SELECT SUM(attempts < %d) AS waiting, SUM(attempts >= %d) AS stopped FROM {$table}",
        CLIENTFLOW_MAX_ATTEMPTS,
        CLIENTFLOW_MAX_ATTEMPTS
    ));
    return ['waiting' => (int) ($row->waiting ?? 0), 'stopped' => (int) ($row->stopped ?? 0)];
}

add_action('admin_notices', function (): void {
    if (!current_user_can('manage_options')) {
        return;
    }
    if (!clientflow_is_configured()) {
        echo '<div class="notice notice-warning"><p><strong>ClientFlow:</strong> add CLIENTFLOW_API_URL and CLIENTFLOW_WEBHOOK_SECRET to wp-config.php. The quote form is disabled until then.</p></div>';
        return;
    }
    $counts = clientflow_outbox_counts();
    if ($counts['waiting'] + $counts['stopped'] > 0) {
        $url = esc_url(admin_url('tools.php?page=clientflow'));
        printf(
            '<div class="notice notice-warning"><p><strong>ClientFlow:</strong> %d enquiries are waiting to reach ClientFlow and %d need attention. <a href="%s">View status</a></p></div>',
            $counts['waiting'],
            $counts['stopped'],
            $url
        );
    }
});

add_action('admin_menu', function (): void {
    add_management_page('ClientFlow', 'ClientFlow', 'manage_options', 'clientflow', 'clientflow_render_admin_page');
});

add_action('admin_post_clientflow_retry', function (): void {
    if (!current_user_can('manage_options')) {
        wp_die('Not allowed', 'Forbidden', ['response' => 403]);
    }
    check_admin_referer('clientflow_retry');
    global $wpdb;
    $wpdb->query($wpdb->prepare(
        'UPDATE ' . clientflow_outbox_table() . ' SET attempts = LEAST(attempts, %d), next_attempt_at = %s',
        CLIENTFLOW_MAX_ATTEMPTS - 1,
        current_time('mysql', true)
    ));
    $sent = clientflow_retry_outbox();
    wp_safe_redirect(add_query_arg('sent', $sent, admin_url('tools.php?page=clientflow')));
    exit;
});

function clientflow_render_admin_page(): void
{
    global $wpdb;
    $counts = clientflow_outbox_counts();
    $rows   = $wpdb->get_results('SELECT created_at, attempts, last_error, next_attempt_at FROM ' . clientflow_outbox_table() . ' ORDER BY id DESC LIMIT 20');
    ?>
    <div class="wrap">
      <h1>ClientFlow lead capture</h1>
      <?php if (isset($_GET['sent'])) : ?>
        <div class="notice notice-success"><p><?php echo esc_html((int) $_GET['sent']); ?> queued enquiries delivered.</p></div>
      <?php endif; ?>
      <table class="widefat striped" style="max-width:720px">
        <tbody>
          <tr><th>Configuration</th><td><?php echo clientflow_is_configured() ? 'Configured' : 'Missing constants in wp-config.php'; ?></td></tr>
          <tr><th>Endpoint</th><td><code><?php echo esc_html(defined('CLIENTFLOW_API_URL') ? rtrim((string) CLIENTFLOW_API_URL, '/') . '/api/webhooks/wordpress' : 'not set'); ?></code></td></tr>
          <tr><th>Waiting to retry</th><td><?php echo esc_html($counts['waiting']); ?></td></tr>
          <tr><th>Stopped (needs attention)</th><td><?php echo esc_html($counts['stopped']); ?></td></tr>
          <tr><th>Next automatic retry</th><td><?php $next = wp_next_scheduled(CLIENTFLOW_CRON_HOOK); echo $next ? esc_html(get_date_from_gmt(gmdate('Y-m-d H:i:s', $next))) : 'not scheduled (reactivate the plugin)'; ?></td></tr>
        </tbody>
      </table>
      <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-top:16px">
        <?php wp_nonce_field('clientflow_retry'); ?>
        <input type="hidden" name="action" value="clientflow_retry">
        <?php submit_button('Retry queued enquiries now', 'secondary', 'submit', false); ?>
      </form>
      <?php if ($rows) : ?>
        <h2>Queued enquiries</h2>
        <p>Contact details are hidden here. They are removed from WordPress once ClientFlow accepts them.</p>
        <table class="widefat striped" style="max-width:720px">
          <thead><tr><th>Received (UTC)</th><th>Attempts</th><th>Next try (UTC)</th><th>Last error</th></tr></thead>
          <tbody>
          <?php foreach ($rows as $row) : ?>
            <tr>
              <td><?php echo esc_html($row->created_at); ?></td>
              <td><?php echo esc_html($row->attempts); ?></td>
              <td><?php echo esc_html((int) $row->attempts >= CLIENTFLOW_MAX_ATTEMPTS ? 'stopped' : $row->next_attempt_at); ?></td>
              <td><?php echo esc_html($row->last_error); ?></td>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
      <?php endif; ?>
    </div>
    <?php
}
