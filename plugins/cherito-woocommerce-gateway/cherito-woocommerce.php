<?php
/**
 * Plugin Name: Cherito WooCommerce Gateway
 * Plugin URI: https://github.com/marchelo23/cherito-bitcoin-payments-sdk
 * Description: Accept Bitcoin Lightning payments in WooCommerce using Cherito API.
 * Version: 1.0.0
 * Author: Cherito Team
 * License: MIT
 * Text Domain: cherito-woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

// Make sure WooCommerce is active
if (!in_array('woocommerce/woocommerce.php', apply_filters('active_plugins', get_option('active_plugins')))) {
    return;
}

add_action('plugins_loaded', 'cherito_init_woocommerce_gateway');
function cherito_init_woocommerce_gateway() {
    class WC_Gateway_Cherito extends WC_Payment_Gateway {
        public function __construct() {
            $this->id = 'cherito_bitcoin';
            $this->icon = ''; // URL to an icon
            $this->has_fields = false;
            $this->method_title = 'Bitcoin (Lightning) via Cherito';
            $this->method_description = 'Allows customers to pay with Bitcoin using the Lightning Network.';

            $this->init_form_fields();
            $this->init_settings();

            $this->title = $this->get_option('title');
            $this->description = $this->get_option('description');
            $this->api_key = $this->get_option('api_key');
            $this->environment = $this->get_option('environment');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        }

        public function init_form_fields() {
            $this->form_fields = array(
                'enabled' => array(
                    'title' => 'Enable/Disable',
                    'type' => 'checkbox',
                    'label' => 'Enable Bitcoin via Cherito',
                    'default' => 'yes'
                ),
                'title' => array(
                    'title' => 'Title',
                    'type' => 'text',
                    'description' => 'This controls the title which the user sees during checkout.',
                    'default' => 'Bitcoin (Lightning)',
                    'desc_tip' => true,
                ),
                'description' => array(
                    'title' => 'Description',
                    'type' => 'textarea',
                    'description' => 'Payment method description that the customer will see on your checkout.',
                    'default' => 'Pay with Bitcoin via the Lightning Network.',
                ),
                'environment' => array(
                    'title' => 'Environment',
                    'type' => 'select',
                    'options' => array(
                        'sandbox' => 'Sandbox',
                        'production' => 'Production'
                    ),
                    'default' => 'sandbox'
                ),
                'api_key' => array(
                    'title' => 'API Key',
                    'type' => 'password'
                )
            );
        }

        public function process_payment($order_id) {
            $order = wc_get_order($order_id);

            // TODO: Call Cherito API to create a payment intent and get a redirect URL
            $redirect_url = $this->get_return_url($order);

            // Mark as on-hold (we're awaiting the payment)
            $order->update_status('on-hold', 'Awaiting Bitcoin payment via Cherito.');
            wc_reduce_stock_levels($order_id);
            WC()->cart->empty_cart();

            return array(
                'result' => 'success',
                'redirect' => $redirect_url
            );
        }
    }
}

add_filter('woocommerce_payment_gateways', 'cherito_add_woocommerce_gateway');
function cherito_add_woocommerce_gateway($gateways) {
    $gateways[] = 'WC_Gateway_Cherito';
    return $gateways;
}
