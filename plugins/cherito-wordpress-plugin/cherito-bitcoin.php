<?php
/**
 * Plugin Name: Cherito Bitcoin Payments
 * Plugin URI: https://github.com/marchelo23/cherito-bitcoin-payments-sdk
 * Description: Accept Bitcoin Lightning payments on your WordPress site seamlessly using Cherito API.
 * Version: 1.0.0
 * Author: Cherito Team
 * License: MIT
 * Text Domain: cherito-bitcoin
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

define('CHERITO_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('CHERITO_PLUGIN_URL', plugin_dir_url(__FILE__));

class Cherito_Bitcoin_Plugin {

    public function __construct() {
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
    }

    public function add_admin_menu() {
        add_options_page(
            'Cherito Bitcoin Settings',
            'Cherito Bitcoin',
            'manage_options',
            'cherito-bitcoin-settings',
            array($this, 'settings_page_html')
        );
    }

    public function register_settings() {
        register_setting('cherito_options_group', 'cherito_api_key');
        register_setting('cherito_options_group', 'cherito_environment');
    }

    public function settings_page_html() {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1><?= esc_html(get_admin_page_title()); ?></h1>
            <form action="options.php" method="post">
                <?php
                settings_fields('cherito_options_group');
                do_settings_sections('cherito-bitcoin-settings');
                ?>
                <table class="form-table">
                    <tr valign="top">
                        <th scope="row">Environment</th>
                        <td>
                            <select name="cherito_environment">
                                <option value="sandbox" <?php selected(get_option('cherito_environment'), 'sandbox'); ?>>Sandbox</option>
                                <option value="production" <?php selected(get_option('cherito_environment'), 'production'); ?>>Production</option>
                            </select>
                        </td>
                    </tr>
                    <tr valign="top">
                        <th scope="row">API Key</th>
                        <td><input type="password" name="cherito_api_key" value="<?php echo esc_attr(get_option('cherito_api_key')); ?>" class="regular-text" /></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}

// Initialize the plugin
new Cherito_Bitcoin_Plugin();
