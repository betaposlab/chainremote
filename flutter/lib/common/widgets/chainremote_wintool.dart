import 'package:flutter/material.dart';

import '../../consts.dart';
import '../../models/model.dart';

// ChainRemote [윈도우 도구] — 데스크톱 툴바와 모바일 ⋮ 메뉴가 같이 쓰는 표와 판정.
//   두 벌로 두면 도구를 하나 붙일 때 한쪽만 고치게 된다. 메뉴 모양은 각 화면이 그린다.

/// 윈도우 도구를 아는 에이전트 첫 버전. 옛 에이전트는 요청을 조용히 무시하므로,
///   눌러도 아무 일 없는 메뉴를 보이지 않으려고 가린다.
const String kCrWinToolMinAgent = '1.4.161';

/// 메뉴에 거는 도구들. 번호는 프로토콜 CrWinTool.Tool 과 같아야 한다
///   (에이전트 src/chainremote_wintool.rs 의 고정 표). null 은 구분선.
const List<(int, String, IconData)?> kCrWinTools = [
  (0, '장치 관리자', Icons.developer_board_outlined),
  (1, '장치 및 프린터', Icons.print_outlined),
  (2, '서비스', Icons.miscellaneous_services_outlined),
  (3, '작업 관리자', Icons.monitor_heart_outlined),
  null,
  (4, '네트워크 연결', Icons.lan_outlined),
  (5, '사운드', Icons.volume_up_outlined),
  (6, '날짜와 시간', Icons.schedule_outlined),
  null,
  (7, '프로그램 추가/제거', Icons.apps_outlined),
  (8, '이벤트 뷰어', Icons.receipt_long_outlined),
  (10, '그룹 정책 편집기', Icons.policy_outlined),
  (9, '시스템 정보', Icons.info_outline),
];

/// 나중에 붙은 도구는 그 번호를 아는 에이전트에만 보인다 — 옛 에이전트는 모르는 번호를
///   조용히 버려서, 눌러도 아무 일이 없다. 여기 없는 번호는 [kCrWinToolMinAgent] 를 따른다.
const Map<int, String> kCrWinToolItemMinAgent = {10: '1.4.164'};

/// 이 세션에 [윈도우 도구]를 보여도 되면 상대 에이전트 버전을, 아니면 null.
///   상대가 윈도우이고 첫 지원 버전 이상이어야 한다.
String? crWinToolAgentVersion(FfiModel model) {
  final pi = model.pi;
  final v = pi.platformAdditions['chainremote_version'];
  if (pi.platform != kPeerPlatformWindows || v is! String) return null;
  // 거래처가 키보드 제어를 막아 두었으면 에이전트도 거절한다 — 메뉴부터 감춘다.
  if (!crVersionAtLeast(v, kCrWinToolMinAgent) || !model.keyboard) return null;
  return v;
}

/// 그 에이전트가 아는 도구만 남긴 표(구분선 포함).
List<(int, String, IconData)?> crWinToolsFor(String agentVersion) =>
    kCrWinTools.where((t) {
      if (t == null) return true;
      final min = kCrWinToolItemMinAgent[t.$1];
      return min == null || crVersionAtLeast(agentVersion, min);
    }).toList();

/// 우리 버전끼리 v >= min 인가. 못 읽는 버전이면 false — 눌러도 안 되는 메뉴를 보이느니 감춘다.
///   ★상류 `versionCmp`(get_version_number)를 쓰면 안 된다. 마지막 자리를 ×10 해서 윗자리에
///   더하는 셈법이라 빌드 번호가 100 을 넘으면 넘쳐흘러, `1.5.01` 이 `1.4.161` 보다 낮게 나온다.
///   1.5 로 올리는 날 이 메뉴가 통째로 사라진다(1.5.60 까지).
bool crVersionAtLeast(String v, String min) {
  final a = crParseVersion(v), b = crParseVersion(min);
  if (a == null || b == null) return false;
  if (a.$1 != b.$1) return a.$1 > b.$1;
  if (a.$2 != b.$2) return a.$2 > b.$2;
  return a.$3 >= b.$3;
}

/// "1.4.164" → (1, 4, 164). 에이전트 parse_version(chainremote_update_common.rs)과 같은 규칙 —
///   세 조각 미만이거나 앞의 두 조각이 숫자가 아니면 null, 빌드는 앞쪽 숫자만 본다("19-test" → 19).
(int, int, int)? crParseVersion(String s) {
  final parts = s.trim().split('.');
  if (parts.length < 3) return null;
  final major = int.tryParse(parts[0]);
  final minor = int.tryParse(parts[1]);
  if (major == null || minor == null) return null;
  final digits = RegExp(r'^\d*').stringMatch(parts[2]) ?? '';
  return (major, minor, digits.isEmpty ? 0 : int.parse(digits));
}
