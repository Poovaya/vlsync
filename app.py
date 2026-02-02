# app.py
import json
import customtkinter as ctk

from video_player import VideoPlayerGUI
from mqtt_client import MQTTClient
from events import MQTT_EVENT
import pinger

BROKER = "vlsync.drish-shel.com"
PORT = 443


def main():
    root = ctk.CTk()
    pinger.start("vlsync.drish-shel.com", 443)
    mqtt_client = MQTTClient(root, BROKER, PORT)
    mqtt_client.connect()

    def publish_action(payload):
        mqtt_client.publish(payload)

    app = VideoPlayerGUI(root, on_action=publish_action)

    def handle_mqtt_event(event):
        for data in mqtt_client.drain_messages():
            app.handle_remote_action(data)

    root.bind(MQTT_EVENT, handle_mqtt_event)
    root.mainloop()


if __name__ == "__main__":
    main()
