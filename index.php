<?php
declare(strict_types=1);

function jsonResponse(int $status, array $payload): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cleanText(mixed $value, int $maxLength = 255): string
{
    $text = trim((string) $value);
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text) ?? '';
    return function_exists('mb_substr') ? mb_substr($text, 0, $maxLength) : substr($text, 0, $maxLength);
}

function sendEmailNotification(array $config, string $subject, string $message): void
{
    $recipient = filter_var((string) ($config['email_recipient'] ?? ''), FILTER_VALIDATE_EMAIL);
    if ($recipient === false || !function_exists('mail')) {
        return;
    }

    $siteName = cleanText($config['site_name'] ?? 'Інтернет-магазин', 120);
    $fromDomain = strtolower(cleanText($config['mail_from_domain'] ?? '', 180));
    $headers = ['Content-Type: text/plain; charset=UTF-8'];
    if ($fromDomain !== '' && preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/', $fromDomain)) {
        $headers[] = 'From: ' . $siteName . ' <no-reply@' . $fromDomain . '>';
    }

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    if (!mail($recipient, $encodedSubject, $message, implode("\r\n", $headers))) {
        error_log('Order email notification could not be sent.');
    }
}

function sendTelegramNotification(array $config, string $message): void
{
    $token = cleanText($config['telegram_bot_token'] ?? '', 255);
    $chatId = cleanText($config['telegram_chat_id'] ?? '', 120);
    if (!preg_match('/^\d+:[A-Za-z0-9_-]+$/', $token) || $chatId === '' || !function_exists('curl_init')) {
        return;
    }

    $curl = curl_init('https://api.telegram.org/bot' . $token . '/sendMessage');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => ['chat_id' => $chatId, 'text' => $message],
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
    ]);
    $result = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    if ($result === false || $status < 200 || $status >= 300) {
        error_log('Telegram order notification could not be sent.');
    }
}

function postOrder(): never
{
    if (!function_exists('curl_init')) {
        jsonResponse(500, ['ok' => false, 'message' => 'На сервері не підключено PHP cURL. Зверніться до адміністратора сайту.']);
    }

    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || strlen($rawBody) > 131072) {
        jsonResponse(413, ['ok' => false, 'message' => 'Дані замовлення завеликі.']);
    }

    $order = json_decode($rawBody, true);
    if (!is_array($order)) {
        jsonResponse(400, ['ok' => false, 'message' => 'Не вдалося прочитати дані замовлення.']);
    }

    // Невидиме поле має залишатися порожнім. Воно відсікає простих спам-ботів.
    if (cleanText($order['website'] ?? '') !== '') {
        jsonResponse(200, ['ok' => true]);
    }

    $firstName = cleanText($order['firstName'] ?? '', 80);
    $lastName = cleanText($order['lastName'] ?? '', 80);
    $phone = cleanText($order['phone'] ?? '', 40);
    $email = filter_var(cleanText($order['email'] ?? '', 160), FILTER_VALIDATE_EMAIL) ?: '';
    $city = cleanText($order['city'] ?? '', 120);
    $branch = cleanText($order['branch'] ?? '', 180);
    $customerComment = cleanText($order['comment'] ?? '', 500);

    if ($firstName === '' || $lastName === '' || $city === '' || $branch === '' || strlen(preg_replace('/\D+/', '', $phone) ?? '') < 10 || $email === '') {
        jsonResponse(422, ['ok' => false, 'message' => 'Перевірте ім’я, прізвище, телефон, email, місто та відділення Нової пошти.']);
    }

    $items = [];
    $total = 0;
    foreach (($order['items'] ?? []) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $name = cleanText($item['name'] ?? '', 180);
        $price = max(0, (int) ($item['price'] ?? 0));
        $quantity = min(99, max(1, (int) ($item['quantity'] ?? 1)));
        if ($name === '' || $price < 1) {
            continue;
        }
        $items[] = ['name' => $name, 'price' => $price, 'quantity' => $quantity];
        $total += $price * $quantity;
    }

    if ($items === [] || $total < 1) {
        jsonResponse(422, ['ok' => false, 'message' => 'Кошик порожній. Додайте хоча б один товар.']);
    }

    $configPath = __DIR__ . '/lp-crm-config.local.php';
    if (!is_file($configPath)) {
        jsonResponse(503, ['ok' => false, 'message' => 'Приймання замовлень ще не налаштовано на сервері.']);
    }
    $config = require $configPath;
    if (!is_array($config)) {
        jsonResponse(503, ['ok' => false, 'message' => 'Приймання замовлень ще не налаштовано на сервері.']);
    }
    $environmentKey = getenv('LP_CRM_API_KEY');
    $apiKey = $environmentKey !== false && $environmentKey !== '' ? $environmentKey : ($config['api_key'] ?? '');
    if ($apiKey === '') {
        jsonResponse(503, ['ok' => false, 'message' => 'Приймання замовлень ще не налаштовано на сервері.']);
    }

    $cartLines = array_map(
        static fn(array $item): string => sprintf('%s — %d × %d грн', $item['name'], $item['quantity'], $item['price']),
        $items
    );
    $cartSummary = implode("\n", $cartLines);
    $commentParts = ["Склад замовлення:\n" . $cartSummary, 'Разом: ' . $total . ' грн'];
    if ($customerComment !== '') {
        $commentParts[] = 'Коментар клієнта: ' . $customerComment;
    }

    $marketing = is_array($order['marketing'] ?? null) ? $order['marketing'] : [];
    $orderId = preg_replace('/[^a-zA-Z0-9_-]/', '', cleanText($order['requestId'] ?? '', 100));
    if ($orderId === '') {
        $orderId = (string) round(microtime(true) * 10);
    }

    // LP-CRM очікує хоча б один службовий product_id. Ідентифікатор 184
    // узято з наданого клієнтом робочого обробника; реальний склад кошика
    // передається окремо в коментарі та additional_1.
    $crmProducts = [[
        'product_id' => (string) ($config['fallback_product_id'] ?? '184'),
        'price' => (string) $total,
        'count' => '1',
    ]];

    $crmPayload = [
        'key' => (string) $apiKey,
        'order_id' => $orderId,
        'country' => 'UA',
        'office' => (string) ($config['office'] ?? '2'),
        'products' => urlencode(serialize($crmProducts)),
        'bayer_name' => trim($firstName . ' ' . $lastName),
        'phone' => $phone,
        'email' => $email,
        'comment' => implode("\n\n", $commentParts),
        'delivery' => (string) ($config['delivery'] ?? '1'),
        'delivery_adress' => $city . ', Нова пошта: ' . $branch,
        'payment' => '',
        'sender' => urlencode(serialize($_SERVER)),
        'utm_source' => cleanText($marketing['utm_source'] ?? '', 160),
        'utm_medium' => cleanText($marketing['utm_medium'] ?? '', 160),
        'utm_term' => cleanText($marketing['utm_term'] ?? '', 160),
        'utm_content' => cleanText($marketing['utm_content'] ?? '', 160),
        'utm_campaign' => cleanText($marketing['utm_campaign'] ?? '', 160),
        'additional_1' => function_exists('mb_substr') ? mb_substr($cartSummary, 0, 1000) : substr($cartSummary, 0, 1000),
        'additional_2' => 'Разом: ' . $total . ' грн',
        'additional_3' => '',
        'additional_4' => '',
    ];

    $environmentUrl = getenv('LP_CRM_API_URL');
    $apiUrl = $environmentUrl !== false && $environmentUrl !== ''
        ? $environmentUrl
        : (string) ($config['api_url'] ?? 'http://slowride.lp-crm.biz/api/addNewOrder.html');
    $curl = curl_init($apiUrl);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => $crmPayload,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $crmBody = curl_exec($curl);
    $curlError = curl_error($curl);
    $httpStatus = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);

    if ($crmBody === false || $curlError !== '' || $httpStatus < 200 || $httpStatus >= 300) {
        error_log('LP-CRM order error: HTTP ' . $httpStatus . '; ' . $curlError);
        jsonResponse(502, ['ok' => false, 'message' => 'Сервіс замовлень тимчасово недоступний. Спробуйте ще раз.']);
    }

    $crmResult = json_decode((string) $crmBody, true);
    if (is_array($crmResult) && (($crmResult['status'] ?? null) === 'error' || ($crmResult['success'] ?? true) === false)) {
        $logBody = function_exists('mb_substr') ? mb_substr((string) $crmBody, 0, 500) : substr((string) $crmBody, 0, 500);
        error_log('LP-CRM rejected order: ' . $logBody);
        jsonResponse(502, ['ok' => false, 'message' => 'Сервіс не прийняв замовлення. Спробуйте ще раз.']);
    }

    $crmOrderId = is_array($crmResult) ? ($crmResult['order_id'] ?? $crmResult['id'] ?? null) : null;
    $notificationLines = [
        'Нове замовлення',
        'Номер: ' . ($crmOrderId ?: $orderId),
        'Клієнт: ' . trim($firstName . ' ' . $lastName),
        'Телефон: ' . $phone,
        'Email: ' . $email,
        'Доставка: ' . $city . ', Нова пошта: ' . $branch,
        '',
        'Товари:',
        $cartSummary,
        'Разом: ' . $total . ' грн',
    ];
    if ($customerComment !== '') {
        $notificationLines[] = 'Коментар: ' . $customerComment;
    }
    $notificationMessage = implode("\n", $notificationLines);
    $siteName = cleanText($config['site_name'] ?? 'Інтернет-магазин', 120);
    sendEmailNotification($config, 'Нове замовлення з сайту «' . $siteName . '»', $notificationMessage);
    sendTelegramNotification($config, "✅ " . $notificationMessage);

    jsonResponse(200, ['ok' => true, 'orderId' => $crmOrderId ?: $orderId]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_GET['action'] ?? '') === 'order') {
    postOrder();
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    jsonResponse(405, ['ok' => false, 'message' => 'Метод не підтримується.']);
}

header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/index.html');
