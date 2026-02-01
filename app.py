# app.py
import json
import customtkinter as ctk

from video_player import VideoPlayerGUI
from mqtt_client import MQTTClient
from events import MQTT_EVENT

BROKER = "vlsync.drish-shel.com"
PORT = 443

def main():
    root = ctk.CTk()

    mqtt_client = MQTTClient(root, BROKER, PORT)
    mqtt_client.connect()

    def publish_action(payload):
        mqtt_client.publish(payload)

    app = VideoPlayerGUI(root, on_action=publish_action)

    def handle_mqtt_event(event):
        for raw in mqtt_client.drain_messages():
            data = json.loads(raw)
            app.handle_remote_action(data.get("action"))

    root.bind(MQTT_EVENT, handle_mqtt_event)
    root.mainloop()

if __name__ == "__main__":
    main()
