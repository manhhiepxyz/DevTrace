'use strict';

/* =====================================================================
   desktop/shortcut.js — Tạo (hoặc gỡ) lối tắt DevTrace trên màn hình.

   VÌ SAO PHẢI VÒNG VO QUA MỘT THƯ MỤC TRUNG GIAN
   ----------------------------------------------
   Đối tượng COM dùng để tạo tệp .lnk (WScript.Shell) chuyển mọi đường dẫn
   qua bảng mã ANSI cũ. Ký tự không có trong bảng mã đó bị thay bằng "?".
   Dự án này nằm ở "D:\Dự án ma", nên nếu nhét thẳng đường dẫn vào lối tắt
   thì lối tắt sẽ trỏ tới "D:\D? án ma" và không bao giờ chạy được. Đã thử
   và xác nhận đúng như vậy, chứ không phải phỏng đoán.

   Cách xử lý: mọi thứ nhét vào tệp .lnk đều phải là ASCII. Nên DevTrace
   đặt một tệp chuyển tiếp nhỏ ở %LOCALAPPDATA%\DevTrace\ — nơi đường dẫn
   thường là ASCII — và tệp .vbs ở đó giữ đường dẫn thật bằng tiếng Việt
   (vì tệp .vbs là tệp văn bản, đọc được Unicode đầy đủ).

   Chạy:
     node desktop/shortcut.js install              tạo lối tắt trên màn hình
     node desktop/shortcut.js install --startup    thêm cả vào Startup
     node desktop/shortcut.js uninstall            gỡ lối tắt

   hoặc nhấp đúp desktop/install-shortcut.cmd.
   ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NAME = 'DevTrace';
const ICON_SOURCE = path.join(__dirname, 'devtrace.ico');
const FORWARDER_NAME = NAME + '.vbs';

/* --- Đường dẫn trung gian -------------------------------------------- */

function stageDir(options) {
  const explicit = options && options.stage;
  if (explicit) return path.resolve(explicit);
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, NAME);
}

function isAscii(value) {
  return typeof value === 'string' && /^[\x20-\x7E]*$/.test(value);
}

/* --- Bản mô tả lối tắt ----------------------------------------------- */

// Mọi đường dẫn ở đây đều phải là ASCII, nếu không tệp .lnk sẽ hỏng.
function plan(root, options) {
  const opts = options || {};
  const base = root || ROOT;
  const stage = stageDir(opts);
  const forwarder = path.join(stage, FORWARDER_NAME);
  const icon = path.join(stage, 'devtrace.ico');

  const specValue = {
    name: NAME,
    target: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe'),
    args: '"' + forwarder + '"',
    workdir: stage,
    icon: icon + ',0',
    // Mô tả cũng phải là ASCII: tệp .lnk làm hỏng cả dòng này, và huynh sẽ
    // thấy nó trong tooltip của lối tắt.
    description: 'DevTrace - AI coding activity tracker',
    startup: !!opts.startup
  };
  if (opts.folders && opts.folders.length) {
    specValue.folders = opts.folders.map((dir) => path.resolve(dir));
  }

  return { root: base, stage: stage, forwarder: forwarder, icon: icon, spec: specValue };
}

// Tệp .vbs là văn bản nên giữ được tiếng Việt; đây là chỗ duy nhất ghi lại
// đường dẫn thật của dự án.
function vbsString(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function forwarderSource(root) {
  const real = path.join(root, 'desktop', 'DevTrace.vbs');
  return [
    'Option Explicit',
    '',
    "' Tệp này do DevTrace sinh ra khi huynh tạo lối tắt ngoài màn hình.",
    "' Nó tồn tại chỉ vì tệp .lnk của Windows không giữ được tiếng Việt trong",
    "' đường dẫn. Đừng sửa tay — nó sẽ bị ghi lại mỗi lần tạo lối tắt.",
    "' Muốn gỡ: nhấp đúp desktop\\uninstall-shortcut.cmd.",
    '',
    'Dim fso, sh, target',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set sh = CreateObject("WScript.Shell")',
    '',
    'target = ' + vbsString(real),
    '',
    'If Not fso.FileExists(target) Then',
    '  MsgBox "Không tìm thấy DevTrace ở:" & vbCrLf & vbCrLf & ' + vbsString(root) + ' & vbCrLf & vbCrLf & _',
    '         "Có thể thư mục đã bị chuyển đi hoặc đổi tên. Huynh tạo lại lối tắt nhé.", 16, "DevTrace"',
    '  WScript.Quit 1',
    'End If',
    '',
    'sh.Run "wscript.exe """ & target & """", 0, False',
    ''
  ].join('\r\n');
}

function powershellExe() {
  const candidate = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { if (fs.statSync(candidate).isFile()) return candidate; } catch (e) { /* dùng lệnh trần */ }
  return 'powershell.exe';
}

// Đường dẫn nhúng vào mã PowerShell: bọc nháy đơn, nháy đơn bên trong nhân đôi.
function quote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/* --- Hai đoạn PowerShell, chỉ khác nhau ở việc tạo hay xoá ----------- */

function specHeader(jobFile, resultFile, withStartup) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$Job = ' + quote(jobFile),
    '$Out = ' + quote(resultFile),
    '$spec = Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json',
    "$folders = @([Environment]::GetFolderPath('Desktop'))"
  ];
  if (withStartup) lines.push("if ($spec.startup) { $folders += [Environment]::GetFolderPath('Startup') }");
  lines.push('if ($spec.folders) { $folders = @($spec.folders) }');
  return lines;
}

function applyScript(jobFile, resultFile) {
  return specHeader(jobFile, resultFile, true).concat([
    '$made = @()',
    '$shell = New-Object -ComObject WScript.Shell',
    'foreach ($dir in $folders) {',
    '  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    "  $file = Join-Path $dir ($spec.name + '.lnk')",
    '  $lnk = $shell.CreateShortcut($file)',
    '  $lnk.TargetPath = $spec.target',
    '  $lnk.Arguments = $spec.args',
    '  $lnk.WorkingDirectory = $spec.workdir',
    '  $lnk.IconLocation = $spec.icon',
    '  $lnk.Description = $spec.description',
    '  $lnk.Save()',
    '  $made += $file',
    '}',
    '$made | Set-Content -LiteralPath $Out -Encoding UTF8'
  ]).join('\r\n');
}

function removeScript(jobFile, resultFile) {
  return specHeader(jobFile, resultFile, false).concat([
    "$folders += [Environment]::GetFolderPath('Startup')",
    '$gone = @()',
    'foreach ($dir in $folders) {',
    "  $file = Join-Path $dir ($spec.name + '.lnk')",
    '  if (Test-Path -LiteralPath $file) { [System.IO.File]::Delete($file); $gone += $file }',
    '}',
    '$gone | Set-Content -LiteralPath $Out -Encoding UTF8'
  ]).join('\r\n');
}

/* --- Ghi thư mục trung gian ------------------------------------------ */

function ensureIcon() {
  if (!fs.existsSync(ICON_SOURCE)) require('./make-icon').writeIcon(ICON_SOURCE);
  return ICON_SOURCE;
}

// Tệp chuyển tiếp ghi bằng UTF-16 kèm BOM — cũng vì lý do ở đầu tệp: đó là
// hệ mã duy nhất Windows Script Host đọc đúng tiếng Việt.
function writeStage(planValue) {
  fs.mkdirSync(planValue.stage, { recursive: true });
  fs.writeFileSync(planValue.forwarder, '\uFEFF' + forwarderSource(planValue.root), 'utf16le');
  fs.copyFileSync(ensureIcon(), planValue.icon);
  return planValue;
}

function nonAsciiFields(planValue) {
  const specValue = planValue.spec;
  const fields = { target: specValue.target, args: specValue.args, workdir: specValue.workdir, icon: specValue.icon };
  return Object.keys(fields).filter((key) => !isAscii(fields[key]));
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Đưa bản mô tả cho PowerShell rồi đọc lại kết quả. Tách khỏi phần in ấn để
// bên kiểm thử gọi được.
function execute(kind, planValue) {
  const specValue = Object.assign({}, planValue.spec);
  if (kind === 'remove') specValue.startup = true;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devtrace-lnk-'));
  const jobFile = path.join(dir, 'job.json');
  const resultFile = path.join(dir, 'result.txt');
  const scriptFile = path.join(dir, 'apply.ps1');
  fs.writeFileSync(jobFile, JSON.stringify(specValue, null, 2), 'utf8');

  const source = kind === 'remove' ? removeScript(jobFile, resultFile) : applyScript(jobFile, resultFile);
  // PowerShell 5.1 chỉ đọc đúng tiếng Việt khi tệp .ps1 có BOM.
  fs.writeFileSync(scriptFile, '\uFEFF' + source, 'utf8');

  const run = (planValue.options && planValue.options.run) || childProcess.spawnSync;
  let out = {};
  try {
    out = run(powershellExe(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      { encoding: 'utf8', timeout: 120000 }) || {};
  } catch (error) {
    out = { error: error };
  }

  return {
    kind: kind,
    spec: specValue,
    scriptFile: scriptFile,
    status: typeof out.status === 'number' ? out.status : null,
    spawnError: out.error || null,
    stderr: String(out.stderr || '').trim(),
    touched: readLines(resultFile)
  };
}

/* --- Tạo và gỡ ------------------------------------------------------- */

function install(options) {
  const opts = options || {};
  const planValue = plan(opts.root, opts);
  planValue.options = opts;

  const blocked = nonAsciiFields(planValue);
  if (blocked.length) {
    return { ok: false, reason: 'non-ascii', fields: blocked, plan: planValue };
  }

  try {
    writeStage(planValue);
  } catch (error) {
    return { ok: false, reason: 'stage-failed', error: error, plan: planValue };
  }

  const result = execute('apply', planValue);
  const made = result.touched.filter((file) => fs.existsSync(file));
  return { ok: !result.spawnError && result.status === 0 && made.length > 0, plan: planValue, made: made, result: result };
}

/* --- Chốt chặn trước khi xoá thư mục trung gian ---------------------- */

/* Dấu nhận dạng trong tệp chuyển tiếp. Có nó nghĩa là tệp do chính
   forwarderSource() viết ra, chứ không phải một tệp cùng tên ai đó đặt vào. */
const FORWARDER_MARK = 'Tệp này do DevTrace sinh ra';

/* Những tên được phép có trong thư mục trung gian — đúng những gì writeStage
   đặt vào, không hơn. */
const STAGE_ALLOWED = [FORWARDER_NAME.toLowerCase(), path.basename(ICON_SOURCE).toLowerCase()];

function normalizePath(value) {
  return path.resolve(String(value)).replace(/[\\/]+$/, '').toLowerCase();
}

function isInside(child, parent) {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c !== p && c.startsWith(p + path.sep);
}

/* Có được phép xoá cả cây thư mục trung gian không?
   Trả về null nếu được, hoặc một câu nói vì sao không.

   Đây là lệnh xoá cả cây, nên không được phép đoán. Bản trước chỉ kiểm tra
   mỗi sự có mặt của DevTrace.vbs — nhưng "có DevTrace.vbs" không phân biệt
   được thư mục trung gian thật với bất kỳ thư mục nào huynh trót đặt tệp đó
   vào. Chạy `uninstall --stage D:\` khi D:\ có tệp ấy là xoá sạch ổ đĩa.

   Ba câu hỏi:
     1. Đây có phải gốc ổ đĩa không? (cha của nó là chính nó — xoá là xoá cả ổ)
     2. Đây có phải thư mục nhà, thư mục dự án, hay chỗ chứa chúng không?
     3. Trong đó có ĐÚNG đồ của DevTrace không — và tệp chuyển tiếp có đúng
        là do DevTrace viết ra không? */
function stageRefusal(stage) {
  const target = path.resolve(String(stage));

  if (path.dirname(target) === target) return 'đây là gốc ổ đĩa';

  for (const keep of [os.homedir(), ROOT]) {
    if (normalizePath(keep) === normalizePath(target)) return 'đây chính là ' + keep;
    if (isInside(keep, target)) return 'đây là thư mục chứa ' + keep;
  }

  let names;
  try { names = fs.readdirSync(target); } catch (error) { return 'không đọc được nội dung'; }

  const extra = names.filter((name) => STAGE_ALLOWED.indexOf(name.toLowerCase()) === -1);
  if (extra.length) {
    return 'trong đó còn tệp khác của huynh (' + extra.slice(0, 3).join(', ') +
      (extra.length > 3 ? ', …' : '') + ')';
  }

  let text;
  const forwarder = path.join(target, FORWARDER_NAME);
  if (!fs.existsSync(forwarder)) return 'không có ' + FORWARDER_NAME + ' ở trong';
  try { text = fs.readFileSync(forwarder, 'utf16le'); }
  catch (error) { return 'không đọc được ' + FORWARDER_NAME; }
  if (text.indexOf(FORWARDER_MARK) === -1) {
    return FORWARDER_NAME + ' không phải do DevTrace tạo ra';
  }
  return null;
}

function uninstall(options) {
  const opts = options || {};
  const planValue = plan(opts.root, opts);
  planValue.options = opts;
  const result = execute('remove', planValue);

  // Dọn thư mục trung gian, nhưng chỉ khi nó qua được chốt chặn ở trên.
  let stageRemoved = false;
  let stageKept = null;
  if (fs.existsSync(planValue.stage)) {
    stageKept = stageRefusal(planValue.stage);
    if (!stageKept) {
      try {
        fs.rmSync(planValue.stage, { recursive: true, force: true });
        stageRemoved = true;
      } catch (error) {
        stageKept = 'không xoá được: ' + String((error && error.message) || error);
      }
    }
  }

  return {
    ok: !result.spawnError && result.status === 0,
    plan: planValue,
    gone: result.touched.filter((file) => !fs.existsSync(file)),
    stageRemoved: stageRemoved,
    stageKept: stageKept,
    result: result
  };
}

/* --- Lối vào dòng lệnh ---------------------------------------------- */

function parseArgs(argv) {
  const args = argv || [];
  const options = { startup: false, folders: null, stage: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--startup') options.startup = true;
    else if (arg === '--dest') { options.folders = [args[++i]]; }
    else if (arg === '--stage') { options.stage = args[++i]; }
  }
  return options;
}

function main(argv) {
  const args = argv || process.argv.slice(2);
  const command = (args[0] === 'uninstall' || args[0] === 'remove') ? 'uninstall' : 'install';
  const options = parseArgs(args.slice(1));
  const out = command === 'install' ? install(options) : uninstall(options);

  if (out.ok) {
    if (command === 'install') {
      process.stdout.write('Đã tạo lối tắt:\n');
      out.made.forEach((file) => process.stdout.write('  ' + file + '\n'));
      process.stdout.write('\nTừ giờ chỉ cần nhấp đúp biểu tượng DevTrace trên màn hình.\n');
      process.stdout.write('Muốn tắt: nhấp đúp desktop\\stop-devtrace.cmd\n');
      process.stdout.write('\nTệp chuyển tiếp nằm ở: ' + out.plan.stage + '\n');
      process.stdout.write('(chỗ đó chỉ chứa đường dẫn tới dự án, không chứa dữ liệu của huynh)\n');
    } else {
      if (out.gone.length) {
        process.stdout.write('Đã gỡ lối tắt:\n');
        out.gone.forEach((file) => process.stdout.write('  ' + file + '\n'));
      } else {
        process.stdout.write('Không có lối tắt nào để gỡ.\n');
      }
      if (out.stageRemoved) process.stdout.write('Đã dọn thư mục trung gian: ' + out.plan.stage + '\n');
      if (out.stageKept) {
        process.stdout.write('Để lại thư mục trung gian: ' + out.plan.stage + '\n');
        process.stdout.write('  Lý do: ' + out.stageKept + '\n');
        process.stdout.write('  Không sao — muốn xoá thì huynh tự xoá tay.\n');
      }
    }
    return 0;
  }

  if (out.reason === 'non-ascii') {
    process.stdout.write('Không tạo được lối tắt.\n\n');
    process.stdout.write('Lý do: Windows không giữ được ký tự ngoài ASCII trong tệp .lnk,\n');
    process.stdout.write('nên DevTrace chỉ tạo lối tắt khi đường dẫn trung gian toàn ASCII.\n');
    process.stdout.write('Chỗ vướng: ' + out.fields.join(', ') + '\n');
    process.stdout.write('Đường dẫn đang dùng: ' + out.plan.stage + '\n\n');
    process.stdout.write('Cách xử lý: chạy lại kèm --stage trỏ tới một thư mục toàn ASCII, ví dụ\n');
    process.stdout.write('  node desktop/shortcut.js install --stage C:\\DevTrace\n');
    return 1;
  }

  process.stdout.write(command === 'install' ? 'Không tạo được lối tắt.\n' : 'Không gỡ được lối tắt.\n');
  if (out.reason === 'stage-failed') {
    process.stdout.write('  Không ghi được thư mục trung gian: ' + out.plan.stage + '\n');
    process.stdout.write('  ' + String((out.error && out.error.message) || out.error) + '\n');
  }
  if (out.result && out.result.spawnError) {
    process.stdout.write('  ' + String(out.result.spawnError.message || out.result.spawnError) + '\n');
  }
  if (out.result && out.result.stderr) process.stdout.write('  ' + out.result.stderr + '\n');
  if (command === 'install') {
    process.stdout.write('\nCách tự làm, không cần công cụ này:\n');
    process.stdout.write('  1. Bấm chuột phải tệp desktop\\DevTrace.vbs\n');
    process.stdout.write('  2. Chọn "Gửi tới" > "Màn hình nền (tạo lối tắt)"\n');
    process.stdout.write('  3. Chuột phải lối tắt mới > Thuộc tính > Đổi biểu tượng\n');
    process.stdout.write('     rồi trỏ tới desktop\\devtrace.ico\n');
  }
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  NAME: NAME,
  ROOT: ROOT,
  ICON_SOURCE: ICON_SOURCE,
  FORWARDER_NAME: FORWARDER_NAME,
  stageDir: stageDir,
  isAscii: isAscii,
  plan: plan,
  vbsString: vbsString,
  forwarderSource: forwarderSource,
  quote: quote,
  powershellExe: powershellExe,
  specHeader: specHeader,
  applyScript: applyScript,
  removeScript: removeScript,
  writeStage: writeStage,
  nonAsciiFields: nonAsciiFields,
  stageRefusal: stageRefusal,
  normalizePath: normalizePath,
  isInside: isInside,
  FORWARDER_MARK: FORWARDER_MARK,
  execute: execute,
  install: install,
  uninstall: uninstall,
  parseArgs: parseArgs,
  main: main
};
