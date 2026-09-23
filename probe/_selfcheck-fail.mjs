// 自检夹具（T7.1 配套 · **故意失败**）：给 `VERIFY_SELFTEST=probe/_selfcheck-fail.mjs`
// 用来验证 verify-all 的**红门路径**（明细是否完整打出 / 日志是否落盘 / GPU 是否打印 / 退出码 1）。
// 它不测任何产品行为，**不要**把它加进 SUITES。
//
// 用法: VERIFY_SELFTEST=probe/_selfcheck-fail.mjs node probe/verify-all.mjs
console.log('自检夹具：这是**故意失败**的一门');
console.log('  ✓ 一行假绿（用来确认"成功分支只回显尾部"）');
console.log('  ✗ 一行假红（用来确认"失败分支打印完整输出"）');
console.log('  红门明细自检：下面这几行**必须**出现在 verify-all 的输出里');
console.log('  红门明细自检：MARKER-SELFTEST-LINE-A');
console.log('  红门明细自检：MARKER-SELFTEST-LINE-B');
console.error('自检夹具 stderr：MARKER-SELFTEST-STDERR');
process.exit(1);
