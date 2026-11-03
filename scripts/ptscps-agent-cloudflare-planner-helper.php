<?php
declare(strict_types=1);

$root = $argv[1] ?? '';
$mode = $argv[2] ?? 'prompt';
if ($root === '' || !is_dir($root . '/wp-content/mu-plugins/esc-agent/src')) {
    fwrite(STDERR, "invalid source root\n"); exit(2);
}
$src = rtrim($root, '/') . '/wp-content/mu-plugins/esc-agent/src/';
spl_autoload_register(static function (string $class) use ($src): void {
    $prefix = 'EscAgent\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) return;
    $file = $src . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) require_once $file;
});
require_once $src . 'Core/SkillRegistry.php';
require_once $src . 'Core/Planner.php';

$allowed = ['product','productDetail','productMaterial','productCompare','promotion','company','policy','contact','payment','knowledge'];
$registry = new \EscAgent\Core\SkillRegistry(rtrim($root, '/') . '/wp-content/mu-plugins/esc-agent/src/Skills', $allowed);
$registry->loadSkillsAutomatically();
if (count($registry->getSkills()) < 8) {
    fwrite(STDERR, "skill registry incomplete\n"); exit(3);
}

if ($mode === 'prompt') {
    $planner = new \EscAgent\Core\Planner($registry, 'diagnostic', null, '', '');
    $prompt = $planner->buildSystemPrompt();
    $prompt .= "\n\nQUY TẮC PTSCPS: Câu hỏi về PTSCPS, tên viết tắt, lĩnh vực hoạt động, dịch vụ, "
        . "nội dung website và dữ liệu doanh nghiệp phải dùng công cụ truy xuất được đăng ký "
        . "(đặc biệt knowledge.search với Page/Post/Product/TablePress đã xuất bản), "
        . "không trả direct_response suy đoán. Dữ liệu ngoài website không thay bằng kiến thức phổ thông. "
        . "Luôn giữ đúng ngôn ngữ vi/en của phiên. Chỉ direct_response cho câu hỏi "
        . "kiến thức phổ thông không liên quan dữ liệu riêng của PTSCPS.";
    echo $prompt;
    exit(0);
}

if ($mode !== 'validate') { fwrite(STDERR, "unknown mode\n"); exit(4); }
$raw = stream_get_contents(STDIN);
$clean = trim((string)preg_replace('/^```(?:json)?\s*|\s*```$/i', '', trim($raw)));
$decoded = json_decode($clean, true);
$result = ['valid'=>false,'reason'=>'invalid_json','skill'=>'','action'=>'','requires_synthesis'=>false,'mode'=>''];
if (!is_array($decoded)) { echo json_encode($result); exit(0); }
if (isset($decoded['direct_response'])) { $result['reason']='direct_response'; echo json_encode($result); exit(0); }
$plan = $decoded['plan'] ?? null;
if (!is_array($plan) || count($plan)<1 || count($plan)>3 || array_keys($plan)!==range(0,count($plan)-1)) {
    $result['reason']='plan_shape'; echo json_encode($result); exit(0);
}
if (!is_bool($decoded['requires_synthesis'] ?? null)) {
    $result['reason']='requires_synthesis_type'; echo json_encode($result); exit(0);
}
foreach ($plan as $step) {
    if (!is_array($step) || !is_string($step['skill'] ?? null) || !is_string($step['action'] ?? null) || !is_array($step['params'] ?? null)) {
        $result['reason']='step_shape'; echo json_encode($result); exit(0);
    }
    $skill = $registry->getSkill($step['skill']);
    if (!$skill || !method_exists($skill,'getActions')) { $result['reason']='unknown_skill'; echo json_encode($result); exit(0); }
    $actions = $skill->getActions();
    if (!isset($actions[$step['action']])) { $result['reason']='unknown_action'; echo json_encode($result); exit(0); }
    $schema = $actions[$step['action']]['params'] ?? [];
    foreach ($step['params'] as $name=>$value) {
        if (!array_key_exists($name,$schema)) { $result['reason']='unknown_param'; echo json_encode($result); exit(0); }
        $type = is_array($schema[$name]) ? ($schema[$name]['type'] ?? 'string') : 'string';
        if ($type==='integer' && !(is_int($value) || (is_string($value) && preg_match('/^-?\d+$/',trim($value))===1))) {
            $result['reason']='invalid_param_type'; echo json_encode($result); exit(0);
        }
        if ($type!=='integer' && !is_string($value) && !is_int($value) && !is_float($value) && !($name==='exclude' && is_array($value))) {
            $result['reason']='invalid_param_type'; echo json_encode($result); exit(0);
        }
    }
    if (method_exists($skill,'validatePlanParams')) {
        $conflict=$skill->validatePlanParams($step['params']);
        if ($conflict!==null) { $result['reason']='param_conflict'; echo json_encode($result); exit(0); }
    }
}
$first=$plan[0];
$result=[
    'valid'=>true,'reason'=>'','skill'=>(string)$first['skill'],'action'=>(string)$first['action'],
    'requires_synthesis'=>(bool)$decoded['requires_synthesis'],
    'mode'=>is_string($first['params']['mode'] ?? null) ? $first['params']['mode'] : '',
];
echo json_encode($result);
