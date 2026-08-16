import 'package:flutter_hbb/common.dart';
import 'package:get/get.dart';

import '../consts.dart';

// TODO: A lot of dup code.

class PrivacyModeState {
  static String tag(String id) => 'privacy_mode_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxString>(tag: key)) {
      final RxString state = ''.obs;
      Get.put<RxString>(state, tag: key);
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxString>(tag: key)) {
      Get.delete<RxString>(tag: key);
    } else {
      Get.find<RxString>(tag: key).value = '';
    }
  }

  static RxString find(String id) => Get.find<RxString>(tag: tag(id));
}

class BlockInputState {
  static String tag(String id) => 'block_input_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxBool>(tag: key)) {
      final RxBool state = false.obs;
      Get.put<RxBool>(state, tag: key);
    } else {
      Get.find<RxBool>(tag: key).value = false;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxBool>(tag: key)) {
      Get.delete<RxBool>(tag: key);
    }
  }

  static RxBool find(String id) => Get.find<RxBool>(tag: tag(id));
}

class CurrentDisplayState {
  static String tag(String id) => 'current_display_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxInt>(tag: key)) {
      final RxInt state = RxInt(0);
      Get.put<RxInt>(state, tag: key);
    } else {
      Get.find<RxInt>(tag: key).value = 0;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxInt>(tag: key)) {
      Get.delete<RxInt>(tag: key);
    }
  }

  static RxInt find(String id) => Get.find<RxInt>(tag: tag(id));
}

class ConnectionType {
  final Rx<String> _secure = kInvalidValueStr.obs;
  final Rx<String> _direct = kInvalidValueStr.obs;
  final Rx<String> _stream_type = kInvalidValueStr.obs;

  Rx<String> get secure => _secure;
  Rx<String> get direct => _direct;
  Rx<String> get stream_type => _stream_type;

  static String get strSecure => 'secure';
  static String get strInsecure => 'insecure';
  static String get strDirect => '';
  static String get strIndirect => '_relay';

  void setSecure(bool v) {
    _secure.value = v ? strSecure : strInsecure;
  }

  void setDirect(bool v) {
    _direct.value = v ? strDirect : strIndirect;
  }

  void setStreamType(String v) {
    _stream_type.value = v;
  }

  bool isValid() {
    return _secure.value != kInvalidValueStr &&
        _direct.value != kInvalidValueStr &&
        _stream_type.value != kInvalidValueStr;
  }
}

class ConnectionTypeState {
  static String tag(String id) => 'connection_type_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<ConnectionType>(tag: key)) {
      final ConnectionType collectionType = ConnectionType();
      Get.put<ConnectionType>(collectionType, tag: key);
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<ConnectionType>(tag: key)) {
      Get.delete<ConnectionType>(tag: key);
    }
  }

  static ConnectionType find(String id) =>
      Get.find<ConnectionType>(tag: tag(id));
}

class FingerprintState {
  static String tag(String id) => 'fingerprint_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxString>(tag: key)) {
      final RxString state = ''.obs;
      Get.put<RxString>(state, tag: key);
    } else {
      Get.find<RxString>(tag: key).value = '';
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxString>(tag: key)) {
      Get.delete<RxString>(tag: key);
    }
  }

  static RxString find(String id) => Get.find<RxString>(tag: tag(id));
}

class ShowRemoteCursorState {
  static String tag(String id) => 'show_remote_cursor_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxBool>(tag: key)) {
      final RxBool state = false.obs;
      Get.put<RxBool>(state, tag: key);
    } else {
      Get.find<RxBool>(tag: key).value = false;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxBool>(tag: key)) {
      Get.delete<RxBool>(tag: key);
    }
  }

  static RxBool find(String id) => Get.find<RxBool>(tag: tag(id));
}

class ShowRemoteCursorLockState {
  static String tag(String id) => 'show_remote_cursor_lock_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxBool>(tag: key)) {
      final RxBool state = false.obs;
      Get.put<RxBool>(state, tag: key);
    } else {
      Get.find<RxBool>(tag: key).value = false;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxBool>(tag: key)) {
      Get.delete<RxBool>(tag: key);
    }
  }

  static RxBool find(String id) => Get.find<RxBool>(tag: tag(id));
}

class KeyboardEnabledState {
  static String tag(String id) => 'keyboard_enabled_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxBool>(tag: key)) {
      // Server side, default true
      final RxBool state = true.obs;
      Get.put<RxBool>(state, tag: key);
    } else {
      Get.find<RxBool>(tag: key).value = true;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxBool>(tag: key)) {
      Get.delete<RxBool>(tag: key);
    }
  }

  static RxBool find(String id) => Get.find<RxBool>(tag: tag(id));
}

class RemoteCursorMovedState {
  static String tag(String id) => 'remote_cursor_moved_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxBool>(tag: key)) {
      final RxBool state = false.obs;
      Get.put<RxBool>(state, tag: key);
    } else {
      Get.find<RxBool>(tag: key).value = false;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxBool>(tag: key)) {
      Get.delete<RxBool>(tag: key);
    }
  }

  static RxBool find(String id) => Get.find<RxBool>(tag: tag(id));
}

class RemoteCountState {
  static String tag() => 'remote_count_';

  static void init() {
    final key = tag();
    if (!Get.isRegistered<RxInt>(tag: key)) {
      final RxInt state = 1.obs;
      Get.put<RxInt>(state, tag: key);
    } else {
      Get.find<RxInt>(tag: key).value = 1;
    }
  }

  static void delete() {
    final key = tag();
    if (Get.isRegistered<RxInt>(tag: key)) {
      Get.delete<RxInt>(tag: key);
    }
  }

  static RxInt find() => Get.find<RxInt>(tag: tag());
}

class PeerBoolOption {
  static String tag(String id, String opt) => 'peer_{$opt}_$id';

  static void init(String id, String opt, bool Function() init_getter) {
    final key = tag(id, opt);
    if (!Get.isRegistered<RxBool>(tag: key)) {
      final RxBool value = RxBool(init_getter());
      Get.put<RxBool>(value, tag: key);
    } else {
      Get.find<RxBool>(tag: key).value = init_getter();
    }
  }

  static void delete(String id, String opt) {
    final key = tag(id, opt);
    if (Get.isRegistered<RxBool>(tag: key)) {
      Get.delete<RxBool>(tag: key);
    }
  }

  static RxBool find(String id, String opt) =>
      Get.find<RxBool>(tag: tag(id, opt));
}

class PeerStringOption {
  static String tag(String id, String opt) => 'peer_{$opt}_$id';

  static void init(String id, String opt, String Function() init_getter) {
    final key = tag(id, opt);
    if (!Get.isRegistered<RxString>(tag: key)) {
      final RxString value = RxString(init_getter());
      Get.put<RxString>(value, tag: key);
    } else {
      Get.find<RxString>(tag: key).value = init_getter();
    }
  }

  static void delete(String id, String opt) {
    final key = tag(id, opt);
    if (Get.isRegistered<RxString>(tag: key)) {
      Get.delete<RxString>(tag: key);
    }
  }

  static RxString find(String id, String opt) =>
      Get.find<RxString>(tag: tag(id, opt));
}

class UnreadChatCountState {
  static String tag(id) => 'unread_chat_count_$id';

  static void init(String id) {
    final key = tag(id);
    if (!Get.isRegistered<RxInt>(tag: key)) {
      final RxInt state = RxInt(0);
      Get.put<RxInt>(state, tag: key);
    } else {
      Get.find<RxInt>(tag: key).value = 0;
    }
  }

  static void delete(String id) {
    final key = tag(id);
    if (Get.isRegistered<RxInt>(tag: key)) {
      Get.delete<RxInt>(tag: key);
    }
  }

  static RxInt find(String id) => Get.find<RxInt>(tag: tag(id));
}

initSharedStates(String id) {
  PrivacyModeState.init(id);
  BlockInputState.init(id);
  CurrentDisplayState.init(id);
  KeyboardEnabledState.init(id);
  ShowRemoteCursorState.init(id);
  ShowRemoteCursorLockState.init(id);
  RemoteCursorMovedState.init(id);
  FingerprintState.init(id);
  PeerBoolOption.init(id, kOptionZoomCursor, () => false);
  UnreadChatCountState.init(id);
  if (isMobile) ConnectionTypeState.init(id); // desktop in other places
}

removeSharedStates(String id) {
  PrivacyModeState.delete(id);
  BlockInputState.delete(id);
  CurrentDisplayState.delete(id);
  ShowRemoteCursorState.delete(id);
  ShowRemoteCursorLockState.delete(id);
  KeyboardEnabledState.delete(id);
  RemoteCursorMovedState.delete(id);
  FingerprintState.delete(id);
  PeerBoolOption.delete(id, kOptionZoomCursor);
  UnreadChatCountState.delete(id);
  if (isMobile) ConnectionTypeState.delete(id);
}

// ChainRemote: 본사가 자기 채팅창을 열었나/닫았나 (거래처 CM 전용).
//   본사가 채팅을 닫으면 거래처 화면의 채팅도 같이 닫아 포스 화면을 곧바로 돌려준다.
//   프로토콜 CrChatPanel → ipc CrChatPanel → 'cr_chat_panel' 이벤트로 여기 들어온다.
//   ★거래처가 직접 말풍선을 눌러 접는 것과는 별개다 — 그건 로컬 토글이고 이건 본사 신호다.
//   null 이 아니라 단순 bool 인 이유: 옛 HQ 는 이 신호를 아예 안 보내고, 그때는 거래처가
//   자기 타이머(120초)로만 접히면 되므로 "신호 없음 = 아무 일도 안 함"이면 충분하다.
final crAgentChatPanelOpen = false.obs;

// ChainRemote: 관리 패널 API 를 못 불렀다 — 빈 문자열이면 정상, 아니면 실패한 목록 이름
//   ("customers" | "favorites"). Rust chainremote_data 의 워밍 재시도가 10회 다 실패하면
//   'cr_data_error' 이벤트로 들어오고, 성공하면 빈 문자열로 지워진다.
//   ★있는 그대로를 보여 주기 위한 값이다. 이게 없으면 "거래처가 0곳"과 "패널에 못 붙었다"가
//   화면에서 똑같이 생긴다 — 앞은 정상이고 뒤는 사고인데 구분할 방법이 없었다(감사 A5).
final crPanelDataError = ''.obs;
