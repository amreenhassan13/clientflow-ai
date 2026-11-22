<?php
// Runs when the plugin is deleted from the WordPress admin.
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
global $wpdb;
$wpdb->query('DROP TABLE IF EXISTS ' . $wpdb->prefix . 'clientflow_outbox');
delete_option('clientflow_db_version');
wp_clear_scheduled_hook('clientflow_retry_outbox');
