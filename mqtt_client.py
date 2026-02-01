# mqtt_client.py
import json
import queue
import time
import paho.mqtt.client as mqtt

from events import MQTT_TOPIC, SENDER_ID

class MQTTClient:
    def __init__(self, root, broker, port):
        self.root = root
        self.queue = queue.Queue()
        self.sender_id = SENDER_ID

        self.client = mqtt.Client(
            transport="websockets",
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        self.client.tls_set()
        self.client.ws_set_options(path="/mqtt")
        self.client.on_message = self._on_message

        self.broker = broker
        self.port = port

    def connect(self, retries=20):
        for _ in range(retries):
            try:
                self.client.connect(self.broker, self.port)
                self.client.loop_start()
                self.client.subscribe(MQTT_TOPIC)
                return
            except Exception:
                time.sleep(1)
        raise RuntimeError("MQTT connection failed")

    def publish(self, payload: dict):
        payload = {
            "sender": self.sender_id,
            **payload,
        }
        self.client.publish(MQTT_TOPIC, json.dumps(payload))

    def _on_message(self, client, userdata, msg):
        data = json.loads(msg.payload.decode())

        # ignore messages we sent ourselves
        if data.get("sender") == self.sender_id:
            return

        self.queue.put(data)
        self.root.event_generate("<<MQTTMessage>>", when="tail")

    def drain_messages(self):
        msgs = []
        while not self.queue.empty():
            msgs.append(self.queue.get())
        return msgs
