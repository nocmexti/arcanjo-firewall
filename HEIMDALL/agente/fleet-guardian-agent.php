<?php
/*
 * Fleet Guardian pfSense Agent
 *
 * Endpoints:
 *   GET /fleet-guardian-agent.php?action=health
 *   GET /fleet-guardian-agent.php?action=config
 *   GET /fleet-guardian-agent.php?action=vpn-status
 *   GET /fleet-guardian-agent.php?action=direct-view&user=admin&exp=...&sig=...
 *
 * The signature is HMAC-SHA256 over "user|exp" using the secret stored in
 * /usr/local/etc/fleet-guardian-agent.secret. Keep this file readable only by root/www.
 */

const FLEET_AGENT_SECRET = "/usr/local/etc/fleet-guardian-agent.secret";

function fleet_json($payload, $code = 200) {
    http_response_code($code);
    header("Content-Type: application/json");
    echo json_encode($payload);
    exit;
}

function fleet_secret() {
    if (!file_exists(FLEET_AGENT_SECRET)) {
        fleet_json(["ok" => false, "error" => "agent secret missing"], 500);
    }
    return trim(file_get_contents(FLEET_AGENT_SECRET));
}

function fleet_verify($user, $exp, $sig) {
    if (!$user || !$exp || !$sig || time() > intval($exp)) {
        return false;
    }
    $expected = hash_hmac("sha256", $user . "|" . $exp, fleet_secret());
    return hash_equals($expected, $sig);
}

$action = $_GET["action"] ?? "health";

if ($action === "health") {
    fleet_json(["ok" => true, "version" => "0.3.2"]);
}

function fleet_agent_token_required($scope) {
    $auth = $_SERVER["HTTP_X_FLEET_AGENT_TOKEN"] ?? "";
    $expected = hash_hmac("sha256", $scope, fleet_secret());
    if (!hash_equals($expected, $auth)) {
        fleet_json(["ok" => false, "error" => "unauthorized"], 401);
    }
}

function fleet_xml_text($node, $path, $default = "") {
    $found = $node->xpath($path);
    if (!$found || !isset($found[0])) {
        return $default;
    }
    return trim((string)$found[0]);
}

function fleet_command($command) {
    $output = @shell_exec($command . " 2>/dev/null");
    return is_string($output) ? $output : "";
}

function fleet_bytes($value) {
    $bytes = floatval($value);
    if ($bytes >= 1073741824) {
        return round($bytes / 1073741824, 2) . " GiB";
    }
    if ($bytes >= 1048576) {
        return round($bytes / 1048576, 2) . " MiB";
    }
    if ($bytes >= 1024) {
        return round($bytes / 1024, 2) . " KiB";
    }
    return intval($bytes) . " B";
}

function fleet_short_name($name) {
    $name = preg_replace('/^VPN_(SITE_TO_SITE|SITE2CLIENTE|CLIENT_TO_SITE|SITE_TO_CLIENTE)_?/i', '', $name);
    $name = preg_replace('/^VPN_/i', '', $name);
    $name = preg_replace('/_DATACENTER$/i', '', $name);
    $name = str_replace('_', ' ', $name);
    return trim($name) ?: "VPN";
}

function fleet_openvpn_status_files() {
    $files = [];
    foreach ([
        "/var/etc/openvpn/*.status",
        "/var/etc/openvpn/*.status.log",
        "/var/etc/openvpn/*/status",
        "/var/etc/openvpn/*/status.log",
        "/var/etc/openvpn/*/*.status",
        "/var/etc/openvpn/*/*.status.log",
        "/tmp/openvpn*.status",
        "/tmp/openvpn*.status.log",
    ] as $pattern) {
        foreach (glob($pattern) ?: [] as $file) {
            $files[$file] = $file;
        }
    }
    return array_values($files);
}

function fleet_openvpn_status_basename($file) {
    $base = basename($file);
    if ($base === "status" || $base === "status.log") {
        $parent = basename(dirname($file));
        if ($parent !== "" && $parent !== "." && $parent !== "/") {
            $base = $parent;
        }
    }
    $base = preg_replace('/\.status(\.log)?$/', '', $base);
    return $base ?: basename($file);
}

function fleet_openvpn_aliases($instance, $title = "") {
    $aliases = [];
    foreach ([$instance, $title] as $value) {
        $value = trim((string)$value);
        if ($value === "") {
            continue;
        }
        $aliases[] = $value;
        $first = preg_split('/\s*:\s*/', $value)[0] ?? "";
        if ($first !== "" && $first !== $value) {
            $aliases[] = $first;
        }
    }
    foreach ($aliases as $alias) {
        if (preg_match('/ovpns(\d+)/i', $alias, $m)) {
            $aliases[] = "ovpns" . $m[1];
            $aliases[] = "server" . $m[1];
            $aliases[] = "openvpn_server" . $m[1];
        }
        if (preg_match('/ovpnc(\d+)/i', $alias, $m)) {
            $aliases[] = "ovpnc" . $m[1];
            $aliases[] = "client" . $m[1];
            $aliases[] = "openvpn_client" . $m[1];
        }
        if (preg_match('/server(\d+)/i', $alias, $m)) {
            $aliases[] = "ovpns" . $m[1];
            $aliases[] = "server" . $m[1];
            $aliases[] = "openvpn_server" . $m[1];
        }
        if (preg_match('/client(\d+)/i', $alias, $m)) {
            $aliases[] = "ovpnc" . $m[1];
            $aliases[] = "client" . $m[1];
            $aliases[] = "openvpn_client" . $m[1];
        }
    }
    return array_values(array_unique(array_filter(array_map("strtolower", $aliases))));
}

function fleet_openvpn_runtime() {
    $instances = [];
    $connections = [];
    $files = fleet_openvpn_status_files();
    foreach ($files as $file) {
        $content = @file_get_contents($file);
        if (!is_string($content) || $content === "") {
            continue;
        }
        $base = fleet_openvpn_status_basename($file);
        $title = $base;
        $instance = $base;
        $clients = 0;
        $last_change = "";
        $bytes_in = 0;
        $bytes_out = 0;
        foreach (preg_split('/\r?\n/', $content) as $line) {
            $line = trim($line);
            if ($line === "") {
                continue;
            }
            $cols = str_getcsv($line);
            if (($cols[0] ?? "") === "TITLE" && isset($cols[1])) {
                $title = $cols[1];
            }
            if (($cols[0] ?? "") === "CLIENT_LIST" && count($cols) >= 7) {
                $has_ipv6 = isset($cols[4]) && !is_numeric($cols[4]);
                $bytes_received_idx = $has_ipv6 ? 5 : 4;
                $bytes_sent_idx = $has_ipv6 ? 6 : 5;
                $connected_idx = $has_ipv6 ? 7 : 6;
                $username_idx = $has_ipv6 ? 9 : 8;
                $client_id_idx = $has_ipv6 ? 10 : 9;
                $clients++;
                $bytes_in += intval($cols[$bytes_received_idx] ?? 0);
                $bytes_out += intval($cols[$bytes_sent_idx] ?? 0);
                $last_change = (string)($cols[$connected_idx] ?? $last_change);
                $cipher = "-";
                for ($i = count($cols) - 1; $i >= 0; $i--) {
                    if (preg_match('/AES|CHACHA|BF-|GCM|CBC/i', (string)$cols[$i])) {
                        $cipher = (string)$cols[$i];
                        break;
                    }
                }
                $user = trim((string)($cols[$username_idx] ?? ""));
                if ($user === "") {
                    $user = (string)($cols[1] ?? "-");
                }
                $connections[] = [
                    "type" => "openvpn",
                    "id" => ($cols[$client_id_idx] ?? $cols[1]) . "-" . ($cols[2] ?? $clients),
                    "parentId" => $instance,
                    "instance" => $instance,
                    "user" => $user,
                    "realAddress" => (string)($cols[2] ?? "-"),
                    "virtualAddress" => (string)($cols[3] ?? "-"),
                    "connectedAt" => (string)($cols[$connected_idx] ?? "-"),
                    "bytesReceived" => fleet_bytes($cols[$bytes_received_idx] ?? 0),
                    "bytesSent" => fleet_bytes($cols[$bytes_sent_idx] ?? 0),
                    "cipher" => $cipher,
                ];
            }
        }
        $row = [
            "instance" => $instance,
            "title" => $title,
            "clients" => $clients,
            "lastChange" => $last_change,
            "bytesReceived" => fleet_bytes($bytes_in),
            "bytesSent" => fleet_bytes($bytes_out),
            "status" => $clients > 0 || strpos(strtolower($content), "client_list") !== false ? "online" : "offline",
        ];
        foreach (fleet_openvpn_aliases($instance, $title) as $alias) {
            $instances[$alias] = $row;
        }
    }
    return ["instances" => $instances, "connections" => $connections, "files" => array_values($files)];
}

function fleet_openvpn_runtime_match($instances, $candidates) {
    foreach ($candidates as $candidate) {
        $key = strtolower((string)$candidate);
        if (isset($instances[$key])) {
            return $instances[$key];
        }
    }
    return null;
}

function fleet_openvpn_processes() {
    return fleet_command("(pgrep -af openvpn 2>/dev/null || true); echo; (ps axww -o command 2>/dev/null | grep '[o]penvpn' || true)");
}

function fleet_openvpn_process_online($processes, $candidates, $remote = "") {
    $haystack = strtolower((string)$processes);
    foreach ($candidates as $candidate) {
        if ($candidate !== "" && strpos($haystack, strtolower($candidate)) !== false) {
            return true;
        }
    }
    return $remote !== "" && $remote !== "-" && strpos($haystack, strtolower($remote)) !== false;
}

function fleet_compact_status($status) {
    $value = strtolower(trim((string)$status));
    if (preg_match('/connected|established|active|running|up|handshake/', $value)) {
        return "online";
    }
    if (preg_match('/disabled|disable/', $value)) {
        return "disabled";
    }
    if (preg_match('/down|stopped|failed|offline|error/', $value)) {
        return "offline";
    }
    return "offline";
}

function fleet_ipsec_runtime_match($runtime, $remote) {
    $remote = trim((string)$remote);
    $haystack = strtolower((string)$runtime);
    $candidates = [];
    if ($remote !== "" && $remote !== "-") {
        $candidates[] = strtolower($remote);
        $resolved = @gethostbyname($remote);
        if (is_string($resolved) && $resolved !== "" && $resolved !== $remote) {
            $candidates[] = strtolower($resolved);
        }
    }
    foreach (array_unique($candidates) as $candidate) {
        if ($candidate !== "" && strpos($haystack, $candidate) !== false) {
            return $candidate;
        }
    }
    return "";
}

function fleet_ipsec_runtime_detail($runtime, $matched) {
    $text = (string)$runtime;
    if ($matched === "") {
        return ["status" => "offline", "detail" => "sem SA ativa encontrada", "lastChange" => "-"];
    }
    $status = preg_match('/Established/i', $text) ? "online" : "online";
    $detail = "SA encontrada";
    $last = "-";
    if (preg_match('/Established\s+([0-9]+\s+seconds(?:\s+\([^)]+\))?\s+ago)/i', $text, $m)) {
        $last = $m[1];
    } elseif (preg_match('/Status\s+Established\s+([0-9]+\s+seconds(?:\s+\([^)]+\))?\s+ago)/i', $text, $m)) {
        $last = $m[1];
    }
    if (preg_match('/Bytes-In:\s*([0-9,]+).*?Bytes-Out:\s*([0-9,]+)/is', $text, $m)) {
        $detail .= " - in " . $m[1] . " / out " . $m[2];
    }
    return ["status" => $status, "detail" => $detail, "lastChange" => $last];
}

function fleet_vpn_status() {
    $config = @simplexml_load_file("/cf/conf/config.xml");
    if (!$config) {
        fleet_json(["ok" => false, "error" => "config.xml unavailable"], 500);
    }

    $openvpn_runtime = fleet_openvpn_processes();
    $openvpn_runtime_data = fleet_openvpn_runtime();
    $ipsec_runtime = fleet_command("(swanctl --list-sas 2>/dev/null || true); echo; (ipsec statusall 2>/dev/null || ipsec status 2>/dev/null || true); echo; (setkey -D 2>/dev/null || true)");
    $wg_runtime = fleet_command("wg show all dump");
    $vpns = [];
    $connections = [];

    foreach ($config->xpath("/pfsense/openvpn/openvpn-server") ?: [] as $v) {
        $id = (string)$v->vpnid;
        $name = fleet_xml_text($v, "description", "OpenVPN");
        $remote = fleet_xml_text($v, "tunnel_network", "-");
        $disabled = fleet_xml_text($v, "disable") === "yes";
        $candidates = ["ovpns" . $id, "server" . $id, "openvpn_server" . $id];
        $runtime = fleet_openvpn_runtime_match($openvpn_runtime_data["instances"], $candidates);
        $process_online = fleet_openvpn_process_online($openvpn_runtime, $candidates);
        $status = $disabled ? "disabled" : ($runtime || $process_online ? "online" : "offline");
        $vpns[] = [
            "type" => "openvpn",
            "id" => "ovpns" . $id,
            "name" => fleet_short_name($name),
            "status" => $status,
            "remote" => $remote,
            "detail" => $runtime ? (($runtime["clients"] ?? 0) . " usuarios") : ($process_online ? "processo ativo" : "sem runtime"),
            "virtualAddress" => $remote,
            "lastChange" => $runtime["lastChange"] ?? "-",
            "bytesReceived" => $runtime["bytesReceived"] ?? "-",
            "bytesSent" => $runtime["bytesSent"] ?? "-",
        ];
    }

    foreach ($config->xpath("/pfsense/openvpn/openvpn-client") ?: [] as $v) {
        $id = (string)$v->vpnid;
        $name = fleet_xml_text($v, "description", "OpenVPN client");
        $remote = fleet_xml_text($v, "server_addr", "-");
        $disabled = fleet_xml_text($v, "disable") === "yes";
        $candidates = ["ovpnc" . $id, "client" . $id, "openvpn_client" . $id];
        $runtime = fleet_openvpn_runtime_match($openvpn_runtime_data["instances"], $candidates);
        $process_online = fleet_openvpn_process_online($openvpn_runtime, $candidates, $remote);
        $status = $disabled ? "disabled" : ($runtime || $process_online ? "online" : "offline");
        $vpns[] = [
            "type" => "openvpn",
            "id" => "ovpnc" . $id,
            "name" => fleet_short_name($name),
            "status" => $status,
            "remote" => $remote,
            "detail" => $runtime ? "status file ativo" : ($process_online ? "processo ativo" : "sem runtime"),
            "lastChange" => $runtime["lastChange"] ?? "-",
        ];
    }
    $connections = array_merge($connections, $openvpn_runtime_data["connections"]);

    foreach ($config->xpath("/pfsense/ipsec/phase1") ?: [] as $v) {
        $id = (string)$v->ikeid;
        $name = fleet_xml_text($v, "descr", "IPsec");
        $remote = fleet_xml_text($v, "remote-gateway", fleet_xml_text($v, "remote_gateway", "-"));
        $disabled = fleet_xml_text($v, "disabled") === "yes";
        $matched = fleet_ipsec_runtime_match($ipsec_runtime, $remote);
        $ipsec_detail = fleet_ipsec_runtime_detail($ipsec_runtime, $matched);
        $status = $disabled ? "disabled" : $ipsec_detail["status"];
        $vpns[] = [
            "type" => "ipsec",
            "id" => $id,
            "name" => fleet_short_name($name),
            "status" => $status,
            "remote" => $remote,
            "detail" => $matched !== "" ? ($ipsec_detail["detail"] . " - " . $matched) : $ipsec_detail["detail"],
            "lastChange" => $ipsec_detail["lastChange"],
        ];
    }

    $wg_peers = [];
    foreach (preg_split('/\r?\n/', trim($wg_runtime)) as $line) {
        if ($line === "") {
            continue;
        }
        $cols = explode("\t", $line);
        if (count($cols) >= 8) {
            $wg_peers[$cols[0]][] = $cols;
        }
    }
    foreach ($config->xpath("/pfsense/installedpackages/wireguard/tunnels/item") ?: [] as $v) {
        $id = fleet_xml_text($v, "tun", fleet_xml_text($v, "name", "wg"));
        $name = fleet_xml_text($v, "descr", $id);
        $remote = fleet_xml_text($v, "addresses", "-");
        $disabled = fleet_xml_text($v, "disabled") === "yes";
        $peers = $wg_peers[$id] ?? [];
        $recent = 0;
        $rx = 0;
        $tx = 0;
        foreach ($peers as $peer) {
            $handshake = intval($peer[5] ?? 0);
            if ($handshake > 0 && time() - $handshake < 180) {
                $recent++;
            }
            $rx += intval($peer[6] ?? 0);
            $tx += intval($peer[7] ?? 0);
            $connections[] = [
                "type" => "wireguard",
                "id" => substr((string)($peer[1] ?? "peer"), 0, 16),
                "parentId" => $id,
                "instance" => $id,
                "user" => substr((string)($peer[1] ?? "peer"), 0, 16),
                "realAddress" => (string)($peer[3] ?? "-"),
                "virtualAddress" => (string)($peer[4] ?? "-"),
                "connectedAt" => $handshake > 0 ? (time() - $handshake) . "s atras" : "-",
                "bytesReceived" => fleet_bytes($peer[6] ?? 0),
                "bytesSent" => fleet_bytes($peer[7] ?? 0),
                "cipher" => "-",
            ];
        }
        $status = $disabled ? "disabled" : (count($peers) > 0 ? ($recent > 0 ? "online" : "stale") : "offline");
        $vpns[] = [
            "type" => "wireguard",
            "id" => $id,
            "name" => fleet_short_name($name),
            "status" => $status,
            "remote" => $remote,
            "detail" => count($peers) . " peers / " . $recent . " recentes",
            "peers" => count($peers),
            "bytesReceived" => fleet_bytes($rx),
            "bytesSent" => fleet_bytes($tx),
        ];
    }

    fleet_json([
        "ok" => true,
        "vpns" => $vpns,
        "vpnConnections" => $connections,
        "diagnostics" => [
            "openvpnStatusFiles" => $openvpn_runtime_data["files"] ?? [],
            "openvpnRuntimeKeys" => array_keys($openvpn_runtime_data["instances"] ?? []),
            "openvpnProcessSeen" => trim((string)$openvpn_runtime) !== "",
        ],
    ]);
}

if ($action === "config") {
    fleet_agent_token_required("config.xml");
    header("Content-Type: application/xml");
    readfile("/cf/conf/config.xml");
    exit;
}

if ($action === "vpn-status") {
    fleet_agent_token_required("vpn-status");
    fleet_vpn_status();
}

if ($action === "direct-view") {
    $user = $_GET["user"] ?? "";
    $exp = $_GET["exp"] ?? "";
    $sig = $_GET["sig"] ?? "";
    if (!fleet_verify($user, $exp, $sig)) {
        fleet_json(["ok" => false, "error" => "unauthorized"], 401);
    }
    if (!preg_match('/^[A-Za-z0-9_.@-]{1,64}$/', $user)) {
        fleet_json(["ok" => false, "error" => "invalid user"], 400);
    }

    @include_once("config.lib.inc");
    @include_once("phpsessionmanager.inc");

    $protocol = "https";
    if (function_exists("config_get_path")) {
        $protocol = config_get_path("system/webgui/protocol", "https");
    }
    session_set_cookie_params([
        "lifetime" => 0,
        "path" => "/",
        "domain" => null,
        "secure" => ($protocol === "https"),
        "httponly" => true,
        "samesite" => "Lax",
    ]);

    if (function_exists("phpsession_begin")) {
        phpsession_begin();
    } else {
        session_start();
    }
    session_regenerate_id(true);
    $_SESSION["Username"] = $user;
    $_SESSION["Logged_In"] = "True";
    $_SESSION["remoteauth"] = false;
    $_SESSION["authsource"] = "HEIMDALL WebGUI Manager";
    $_SESSION["user_radius_attributes"] = ["nas_identifier" => "webConfigurator-" . gethostname()];
    $_SESSION["last_access"] = time();
    $_SESSION["protocol"] = $protocol;
    $_SESSION["REMOTE_ADDR"] = $_SERVER["REMOTE_ADDR"] ?? "";
    if (function_exists("phpsession_end")) {
        phpsession_end(true);
    } else {
        session_write_close();
    }
    header("Location: /");
    exit;
}

fleet_json(["ok" => false, "error" => "not found"], 404);
