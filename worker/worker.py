import os
import sys
import time
import signal
import logging
from datetime import datetime, timezone

import redis
from pymongo import MongoClient
from bson.objectid import ObjectId

from operations import run_operation

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker] %(levelname)s %(message)s"
)
log = logging.getLogger("worker")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/ai_task_platform")
QUEUE_KEY = os.getenv("TASK_QUEUE_KEY", "ai_tasks_queue")
BLOCK_TIMEOUT_SECONDS = int(os.getenv("BLOCK_TIMEOUT_SECONDS", "5"))

shutdown_requested = False


def handle_shutdown(signum, frame):
    global shutdown_requested
    log.info("Shutdown signal received, finishing current task then exiting...")
    shutdown_requested = True


signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)


def connect_redis():
    while True:
        try:
            client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            client.ping()
            log.info("Connected to Redis at %s", REDIS_URL)
            return client
        except redis.exceptions.RedisError as e:
            log.warning("Redis connection failed (%s), retrying in 3s...", e)
            time.sleep(3)


def connect_mongo():
    while True:
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            log.info("Connected to MongoDB")
            return client
        except Exception as e:
            log.warning("MongoDB connection failed (%s), retrying in 3s...", e)
            time.sleep(3)


def process_task(tasks_collection, task_id: str):
    task = tasks_collection.find_one({"_id": ObjectId(task_id)})
    if not task:
        log.warning("Task %s not found, skipping", task_id)
        return

    log.info("Processing task %s (operation=%s)", task_id, task.get("operation"))

    tasks_collection.update_one(
        {"_id": task["_id"]},
        {
            "$set": {"status": "RUNNING", "startedAt": datetime.now(timezone.utc)},
            "$push": {"logs": "Worker picked up task"}
        }
    )

    # Real string operations finish in microseconds, which makes the pipeline
    # flash past too fast to observe. These staged, delayed log writes simulate
    # a realistic multi-step processing pipeline so status/log progress is
    # actually visible in the UI as the frontend polls.
    STAGE_DELAY_SECONDS = float(os.getenv("STAGE_DELAY_SECONDS", "1.5"))

    try:
        time.sleep(STAGE_DELAY_SECONDS)
        tasks_collection.update_one(
            {"_id": task["_id"]},
            {"$push": {"logs": "Validating input"}}
        )

        time.sleep(STAGE_DELAY_SECONDS)
        tasks_collection.update_one(
            {"_id": task["_id"]},
            {"$push": {"logs": f"Executing operation: {task['operation']}"}}
        )

        time.sleep(STAGE_DELAY_SECONDS)
        result = run_operation(task["operation"], task["inputText"])

        tasks_collection.update_one(
            {"_id": task["_id"]},
            {
                "$set": {
                    "status": "SUCCESS",
                    "result": result,
                    "finishedAt": datetime.now(timezone.utc)
                },
                "$push": {"logs": "Task completed successfully"}
            }
        )
        log.info("Task %s completed", task_id)
    except Exception as e:
        tasks_collection.update_one(
            {"_id": task["_id"]},
            {
                "$set": {"status": "FAILED", "finishedAt": datetime.now(timezone.utc)},
                "$push": {"logs": f"Task failed: {e}"}
            }
        )
        log.error("Task %s failed: %s", task_id, e)


def main():
    redis_client = connect_redis()
    mongo_client = connect_mongo()
    db = mongo_client.get_default_database()
    tasks_collection = db["tasks"]

    log.info("Worker started, listening on queue '%s'", QUEUE_KEY)

    while not shutdown_requested:
        try:
            item = redis_client.blpop(QUEUE_KEY, timeout=BLOCK_TIMEOUT_SECONDS)
            if item is None:
                continue  # timed out waiting, loop again (lets us check shutdown flag)
            _, task_id = item
            process_task(tasks_collection, task_id)
        except redis.exceptions.RedisError as e:
            log.error("Redis error: %s, reconnecting...", e)
            redis_client = connect_redis()
        except Exception as e:
            log.exception("Unexpected error processing task: %s", e)

    log.info("Worker shut down cleanly")
    sys.exit(0)


if __name__ == "__main__":
    main()
