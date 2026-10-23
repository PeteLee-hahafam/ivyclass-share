"""엔진 지킴이: 엔진을 켜 두고, 업데이트한 뒤에는 새 버전으로 다시 켜요. (run_engine.bat 이 이걸 실행해요)"""

import subprocess
import sys
import time

from .updater import RESTART_CODE


def main():
    args = [a for a in sys.argv[1:]]
    first = True
    quick_fails = 0
    while True:
        cmd = [sys.executable, '-m', 'ivy_engine', *args]
        if not first and '--no-browser' not in cmd:
            cmd.append('--no-browser')
        started = time.time()
        try:
            code = subprocess.call(cmd)
        except KeyboardInterrupt:
            return 0
        first = False
        if code == RESTART_CODE:
            print('\n  새 버전으로 다시 켜는 중이에요...\n', flush=True)
            time.sleep(1)
            continue
        if code == 0:
            return 0
        quick_fails = quick_fails + 1 if time.time() - started < 60 else 0
        if quick_fails >= 3:
            print('\n  엔진이 계속 멈춰요. 위의 메시지를 확인해 주세요.\n', flush=True)
            return code
        print('\n  엔진이 멈춰서 10초 뒤에 다시 켤게요...\n', flush=True)
        try:
            time.sleep(10)
        except KeyboardInterrupt:
            return 0


if __name__ == '__main__':
    sys.exit(main())
