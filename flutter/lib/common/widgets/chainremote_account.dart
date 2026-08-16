// ChainRemote 계정 UI 공용 — 데스크톱 사이드바와 모바일 설정이 같은 코드를 쓴다.
//
// 종전엔 비밀번호 변경/로그아웃 다이얼로그가 desktop_home_page.dart 사이드바 안에만 있어
// 모바일에는 **로그아웃 자체가 없었다** — 로그인은 되는데 나갈 방법이 없는 상태(앱 재설치 외).
// 배치(사이드바 칩 ↔ 설정 타일)는 플랫폼마다 다르지만 다이얼로그와 판정 로직은 같으므로
// 여기로 모은다. 로직은 ChainRemoteAuth 의 static API 를 그대로 쓴다.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../common.dart';
import '../../models/platform_model.dart';
import 'chainremote_auth_gate.dart';

/// 비밀번호 변경 다이얼로그. 성공하면 스낵바로 알리고 닫는다.
Future<void> showCrChangePasswordDialog(BuildContext context) async {
  final currentCtrl = TextEditingController();
  final newCtrl = TextEditingController();
  final confirmCtrl = TextEditingController();
  String? errorText;
  bool busy = false;

  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) {
      return StatefulBuilder(builder: (ctx, setState) {
        Future<void> submit() async {
          final current = currentCtrl.text;
          final newPw = newCtrl.text;
          final confirm = confirmCtrl.text;
          if (current.isEmpty || newPw.isEmpty) {
            setState(() => errorText = '모든 칸을 채워주세요');
            return;
          }
          if (newPw.length < 4) {
            setState(() => errorText = '새 비밀번호는 4자 이상이어야 합니다');
            return;
          }
          if (newPw != confirm) {
            setState(() => errorText = '새 비밀번호가 일치하지 않습니다');
            return;
          }
          if (current == newPw) {
            setState(() => errorText = '새 비밀번호가 현재와 동일합니다');
            return;
          }
          setState(() {
            busy = true;
            errorText = null;
          });
          final res = await ChainRemoteAuth.changePassword(current, newPw);
          // await 뒤 — 사용자가 그 사이 창을 닫았을 수 있다.
          if (!ctx.mounted) return;
          if (res.ok) {
            if (ctx.mounted) Navigator.pop(ctx);
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('비밀번호가 변경되었습니다')),
              );
            }
            return;
          }
          setState(() {
            busy = false;
            errorText = res.error ?? '실패';
          });
        }

        return AlertDialog(
          title: const Text('비밀번호 변경'),
          content: SizedBox(
            // 모바일에선 화면 폭을 넘지 않게 제한한다(데스크톱은 종전 그대로 360).
            width: isMobile ? null : 360,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: currentCtrl,
                  enabled: !busy,
                  obscureText: true,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: '현재 비밀번호',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: newCtrl,
                  enabled: !busy,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '새 비밀번호 (4자 이상)',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: confirmCtrl,
                  enabled: !busy,
                  obscureText: true,
                  onSubmitted: (_) => submit(),
                  decoration: const InputDecoration(
                    labelText: '새 비밀번호 확인',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                if (errorText != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    errorText!,
                    style: const TextStyle(color: Colors.red, fontSize: 13),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(ctx),
              child: const Text('취소'),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('변경'),
            ),
          ],
        );
      });
    },
  );
}

/// 로그아웃 확인 → 확인 시 자격증명을 지우고 로그인 화면으로 되돌린다.
Future<void> showCrLogoutConfirm(BuildContext context) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('로그아웃'),
      content: const Text('로그아웃하시겠습니까? 다시 사용하려면 로그인해야 합니다.'),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
        FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('로그아웃')),
      ],
    ),
  );
  if (ok == true) ChainRemoteAuth.logout();
}

/// 내 9자리 ID 를 읽어 자식에게 넘긴다(비었으면 아무것도 안 그림). 표시는 각 플랫폼이 정한다.
class CrMyIdBuilder extends StatelessWidget {
  final Widget Function(BuildContext context, String id) builder;
  const CrMyIdBuilder({Key? key, required this.builder}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: bind.mainGetMyId(),
      builder: (ctx, snapshot) {
        final id = (snapshot.data ?? '').trim();
        if (id.isEmpty) return const SizedBox.shrink();
        return builder(ctx, id);
      },
    );
  }
}

/// 내 ID 복사 — 데스크톱 칩과 모바일 타일이 같은 동작을 쓴다.
void crCopyMyId(String id) {
  Clipboard.setData(ClipboardData(text: id));
  showToast(translate("Copied"));
}
