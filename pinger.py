import socket, time
import threading
from collections import deque

lock = threading.Lock()
latency = 0.0
num_samples = 1
s = socket.socket()
s.settimeout(3)

start = time.time()
try:
    s.connect(("vlsync.drish-shel.com", 443))
    end = time.time()
    latency = (end - start) * 1000  # ms

except Exception as e:
    print("Failed:", e)
finally:
    s.close()


WINDOW = 10  # last N samples
samples = deque(maxlen=WINDOW)
lock = threading.Lock()


def start(host, port, interval=3):
    def loop():
        while True:
            latency = None
            s = socket.socket()
            s.settimeout(30)

            try:
                start_t = time.time()
                s.connect((host, port))
                latency = (time.time() - start_t) * 1000
            except Exception:
                pass
            finally:
                s.close()

            if latency is not None:
                with lock:
                    samples.append(latency)

            time.sleep(interval)

    threading.Thread(target=loop, daemon=True).start()


def get_average():
    with lock:
        if not samples:
            return None
        return sum(samples) / (2 * len(samples))
