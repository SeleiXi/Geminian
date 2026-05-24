export const ANTIGRAVITY_BRIDGE_SOURCE = String.raw`#!/usr/bin/env python3
import asyncio
import json
import platform
import sys
import traceback
from typing import Any


AGENTS: dict[str, Any] = {}
TASKS: dict[str, asyncio.Task[Any]] = {}


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":"), ensure_ascii=False), flush=True)


def import_antigravity():
    from google.antigravity import Agent, LocalAgentConfig
    try:
        from google.antigravity import CapabilitiesConfig
    except Exception:
        CapabilitiesConfig = None
    try:
        from google.antigravity.types import BuiltinTools
    except Exception:
        BuiltinTools = None
    try:
        from google.antigravity.hooks import policy
    except Exception:
        policy = None
    return Agent, LocalAgentConfig, CapabilitiesConfig, BuiltinTools, policy


def build_capabilities(permission_mode: str, CapabilitiesConfig: Any, BuiltinTools: Any) -> Any:
    if permission_mode == "readOnly" or CapabilitiesConfig is None:
        return None
    if permission_mode == "edit" and BuiltinTools is not None:
        for name in ("file_tools", "nondestructive"):
            tool_factory = getattr(BuiltinTools, name, None)
            if callable(tool_factory):
                try:
                    return CapabilitiesConfig(enabled_tools=tool_factory())
                except TypeError:
                    pass
    try:
        return CapabilitiesConfig()
    except TypeError:
        return None


def build_policies(permission_mode: str, policy: Any) -> list[Any]:
    if policy is None:
        return []
    if permission_mode == "yolo":
        allow = getattr(policy, "allow_all", None)
        if callable(allow):
            return [allow()]
        allow = getattr(policy, "allow", None)
        if callable(allow):
            return [allow("*")]
        return []
    deny = getattr(policy, "deny", None)
    if callable(deny):
        return [deny("run_command")]
    return []


def make_config(req: dict[str, Any]) -> Any:
    Agent, LocalAgentConfig, CapabilitiesConfig, BuiltinTools, policy = import_antigravity()
    kwargs: dict[str, Any] = {
        "workspaces": [req["workspace"]],
        "system_instructions": req.get("systemPrompt") or (
            "You are running inside an Obsidian vault through Claudian. "
            "Treat the workspace as the user's vault. Prefer careful Markdown edits."
        ),
    }
    api_key = req.get("apiKey")
    if api_key:
        kwargs["api_key"] = api_key
    capabilities = build_capabilities(req.get("permissionMode", "edit"), CapabilitiesConfig, BuiltinTools)
    if capabilities is not None:
        kwargs["capabilities"] = capabilities
    policies = build_policies(req.get("permissionMode", "edit"), policy)
    if policies:
        kwargs["policies"] = policies
    return Agent, LocalAgentConfig(**kwargs)


async def get_agent(req: dict[str, Any]) -> Any:
    session_id = req["sessionId"]
    existing = AGENTS.get(session_id)
    if existing is not None:
        return existing
    Agent, config = make_config(req)
    manager = Agent(config)
    agent = await manager.__aenter__()
    AGENTS[session_id] = (agent, manager)
    return AGENTS[session_id]


async def close_agent(session_id: str) -> None:
    entry = AGENTS.pop(session_id, None)
    if entry is None:
        return
    _agent, manager = entry
    await manager.__aexit__(None, None, None)


def dump_model(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return repr(value)


async def run_prompt(req: dict[str, Any]) -> None:
    req_id = req["id"]
    try:
        agent, _manager = await get_agent(req)
        response = await agent.chat(req["prompt"])
        async for token in response:
            emit({"id": req_id, "type": "text_delta", "text": token})
        usage = dump_model(getattr(response, "usage_metadata", None))
        if usage:
            emit({"id": req_id, "type": "usage", "usage": usage})
        emit({"id": req_id, "type": "done", "sessionId": req.get("sessionId")})
    except asyncio.CancelledError:
        emit({"id": req_id, "type": "done", "sessionId": req.get("sessionId")})
    except Exception as exc:
        emit({
            "id": req_id,
            "type": "error",
            "content": f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
        })
        emit({"id": req_id, "type": "done", "sessionId": req.get("sessionId")})
    finally:
        TASKS.pop(req_id, None)


async def handle(req: dict[str, Any]) -> None:
    req_id = req.get("id", "")
    req_type = req.get("type")
    if req_type == "ping":
        emit({"id": req_id, "type": "ready", "ok": True, "python": platform.python_version()})
    elif req_type == "prompt":
        task = asyncio.create_task(run_prompt(req))
        TASKS[req_id] = task
    elif req_type == "cancel":
        for task_id, task in list(TASKS.items()):
            if not task.done():
                task.cancel()
            TASKS.pop(task_id, None)
        session_id = req.get("sessionId")
        if session_id:
            await close_agent(session_id)
        emit({"id": req_id, "type": "done", "sessionId": session_id})
    elif req_type == "shutdown":
        for task in list(TASKS.values()):
            task.cancel()
        for session_id in list(AGENTS.keys()):
            await close_agent(session_id)
        emit({"id": req_id, "type": "done"})
        raise SystemExit(0)
    else:
        emit({"id": req_id, "type": "error", "content": f"Unknown request type: {req_type}"})


async def stdin_loop() -> None:
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        try:
            req = json.loads(line)
            await handle(req)
        except SystemExit:
            raise
        except Exception as exc:
            emit({"id": "", "type": "error", "content": f"{type(exc).__name__}: {exc}"})


async def main() -> None:
    try:
        await stdin_loop()
    finally:
        for task in list(TASKS.values()):
            task.cancel()
        for session_id in list(AGENTS.keys()):
            try:
                await close_agent(session_id)
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
`;
