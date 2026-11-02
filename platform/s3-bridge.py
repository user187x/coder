"""The chart's MinIO in plain HTTP on BRIDGE_PORT (9000), as it was before it had TLS: each connection is carried to
MinIO's TLS port in the same pod (BRIDGE_TARGET_PORT, its certificate checked with BRIDGE_CA) and the bytes go both
ways unread - S3 signatures, which name the host the client asked for, stay valid. The nodes' mounts of unencrypted
Cloud Drives and the libraries use it; an encrypted Cloud Drive's key (SSE-C) goes to the TLS port only.
"""
import asyncio
import os
import ssl
import sys

PORT = int(os.environ.get("BRIDGE_PORT", "9000"))
TARGET = int(os.environ.get("BRIDGE_TARGET_PORT", "9443"))
CTX = ssl.create_default_context(cafile=os.environ.get("BRIDGE_CA", "/certs/CAs/ca.crt"))
CHUNK = 256 * 1024


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(CHUNK)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, ssl.SSLError, OSError):
        pass
    finally:
        writer.close()


async def carry(client_reader, client_writer):
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", TARGET, ssl=CTX, server_hostname="localhost"), 10)
    except (OSError, ssl.SSLError, asyncio.TimeoutError) as e:
        print("s3-bridge: MinIO's TLS port did not answer: %s" % e, file=sys.stderr, flush=True)
        client_writer.close()
        return
    await asyncio.gather(pipe(client_reader, writer), pipe(reader, client_writer))


async def main():
    server = await asyncio.start_server(carry, "0.0.0.0", PORT, limit=CHUNK)
    print("s3-bridge: :%d -> MinIO TLS :%d" % (PORT, TARGET), flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
