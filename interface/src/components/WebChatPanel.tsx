import {useEffect, useMemo, useRef, useState} from "react";
import {Link} from "@tanstack/react-router";
import {useWebChat} from "@/hooks/useWebChat";
import {
	isOpenCodeWorker,
	type ActiveWorker,
	type ActiveChannelExecution,
} from "@/hooks/useChannelLiveState";
import {useLiveContext} from "@/hooks/useLiveContext";
import {Markdown} from "@/components/Markdown";
import {ToolCall, type ToolCallPair} from "@/components/ToolCall";
import {type TimelineBranchRun, type TimelineItem, type TimelineWorkerRun} from "@/api/client";

interface WebChatPanelProps {
	agentId: string;
}

function ActiveWorkersPanel({
	workers,
	agentId,
}: {
	workers: ActiveWorker[];
	agentId: string;
}) {
	if (workers.length === 0) return null;

	const allOpenCode = workers.every(isOpenCodeWorker);
	const borderColor = allOpenCode
		? "border-zinc-500/25 bg-zinc-500/5"
		: "border-amber-500/25 bg-amber-500/5";
	const headerColor = allOpenCode ? "text-zinc-200" : "text-amber-200";
	const dotColor = allOpenCode ? "bg-zinc-400" : "bg-amber-400";

	return (
		<div className={`rounded-lg border px-3 py-2 ${borderColor}`}>
			<div className={`mb-2 flex items-center gap-1.5 text-tiny ${headerColor}`}>
				<div className={`h-1.5 w-1.5 animate-pulse rounded-full ${dotColor}`} />
				<span>
					{workers.length} active worker{workers.length !== 1 ? "s" : ""}
				</span>
			</div>
			<div className="flex flex-col gap-1.5">
				{workers.map((worker) => {
					const oc = isOpenCodeWorker(worker);
					return (
						<Link
							key={worker.id}
							to="/agents/$agentId/workers"
							params={{agentId}}
							search={{worker: worker.id}}
							className={`flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-tiny transition-colors ${
								oc
									? "bg-zinc-500/10 hover:bg-zinc-500/20"
									: "bg-amber-500/10 hover:bg-amber-500/20"
							}`}
						>
							<div className={`h-1.5 w-1.5 animate-pulse rounded-full ${oc ? "bg-zinc-400" : "bg-amber-400"}`} />
							<span className={`font-medium ${oc ? "text-zinc-300" : "text-amber-300"}`}>Worker</span>
							<span className="min-w-0 flex-1 truncate text-ink-dull">{worker.task}</span>
							<span className="shrink-0 text-ink-faint">{worker.status}</span>
							{worker.currentTool && (
								<span className={`max-w-40 shrink-0 truncate ${oc ? "text-zinc-400/80" : "text-amber-400/80"}`}>
									{worker.currentTool}
								</span>
							)}
						</Link>
					);
				})}
			</div>
		</div>
	);
}

function ChannelExecutionPanel({
	execution,
	isTyping,
}: {
	execution: ActiveChannelExecution | null | undefined;
	isTyping: boolean;
}) {
	if (!execution) return null;
	const [expanded, setExpanded] = useState(false);

	const pairs: ToolCallPair[] = execution.calls.map((call) => ({
		id: call.id,
		name: call.name,
		argsRaw: call.args,
		args: tryParseJson(call.args),
		resultRaw: call.result,
		result: call.result ? tryParseJson(call.result) : null,
		status: call.status,
	}));

	const showLive = isTyping || execution.currentTool !== null;

	return (
		<div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
			<button
				type="button"
				onClick={() => setExpanded((value) => !value)}
				className="flex w-full min-w-0 items-center gap-2 text-left text-tiny text-emerald-200"
			>
				<div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
				<span>Direct channel execution</span>
				{execution.toolCalls > 0 && (
					<span className="text-emerald-300/75">{execution.toolCalls} tool calls</span>
				)}
				{execution.currentTool && (
					<span className="min-w-0 flex-1 truncate text-emerald-300/85">{execution.currentTool}</span>
				)}
				<span className="ml-auto text-ink-faint">{expanded ? "▾" : "▸"}</span>
			</button>
			{expanded && (
				<>
					{showLive && <ThinkingIndicator />}
					<div className="mt-2 max-h-[55vh] overflow-y-auto pr-1 sm:max-h-[60vh]">
						<div className="flex flex-col gap-1.5">
						{pairs.map((pair) => (
							<ToolCall key={pair.id} pair={pair} />
						))}
						</div>
					</div>
				</>
			)}
		</div>
	);
}

function BranchTimelineItem({item}: {item: TimelineBranchRun}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="rounded-md bg-violet-500/10 px-3 py-2">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full min-w-0 items-start gap-2 text-left"
			>
				<div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-violet-400/60" />
				<span className="text-sm font-medium text-violet-300">Branch</span>
				<span className={`min-w-0 flex-1 text-sm text-ink-dull ${expanded ? "whitespace-normal break-words" : "truncate"}`}>
					{item.description}
				</span>
				{item.conclusion && <span className="text-tiny text-ink-faint">{expanded ? "▾" : "▸"}</span>}
			</button>
			{expanded && item.conclusion && (
				<div className="mt-2 rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-sm text-ink-dull">
					<Markdown className="whitespace-pre-wrap break-words">{item.conclusion}</Markdown>
				</div>
			)}
		</div>
	);
}

function WorkerTimelineItem({item, agentId}: {item: TimelineWorkerRun; agentId: string}) {
	const [expanded, setExpanded] = useState(false);
	const oc = isOpenCodeWorker({task: item.task});
	return (
		<div className={`rounded-md px-3 py-2 ${oc ? "bg-zinc-500/10" : "bg-amber-500/10"}`}>
			<div className="flex min-w-0 items-center gap-2">
				<button
					type="button"
					onClick={() => item.result && setExpanded((v) => !v)}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<div className={`h-2 w-2 flex-shrink-0 rounded-full ${oc ? "bg-zinc-400/60" : "bg-amber-400/60"}`} />
					<span className={`text-sm font-medium ${oc ? "text-zinc-300" : "text-amber-300"}`}>Worker</span>
					<span className={`min-w-0 flex-1 text-sm text-ink-dull ${expanded ? "whitespace-normal break-words" : "truncate"}`}>
						{item.task}
					</span>
					{item.result && <span className="text-tiny text-ink-faint">{expanded ? "▾" : "▸"}</span>}
				</button>
				<Link
					to="/agents/$agentId/workers"
					params={{agentId}}
					search={{worker: item.id}}
					className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-tiny font-medium transition-colors ${
						oc
							? "border-zinc-400/30 text-zinc-300 hover:border-zinc-400/60 hover:bg-zinc-500/15"
							: "border-amber-400/30 text-amber-300 hover:border-amber-400/60 hover:bg-amber-500/15"
					}`}
				>
					Open
				</Link>
			</div>
			{expanded && item.result && (
				<div className={`mt-2 rounded-md border px-3 py-2 ${oc ? "border-zinc-500/20 bg-zinc-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
					<div className="text-sm text-ink-dull">
						<Markdown className="whitespace-pre-wrap break-words">{item.result}</Markdown>
					</div>
				</div>
			)}
		</div>
	);
}

function ThinkingIndicator() {
	return (
		<div className="flex items-center gap-1.5 py-1">
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:0.2s]" />
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:0.4s]" />
		</div>
	);
}

type OverrideMode = "on" | "off" | "unknown";

function OverrideControls({
	mode,
	onEnable,
	onDisable,
	onRefresh,
	busy,
	disabled,
}: {
	mode: OverrideMode;
	onEnable: () => void;
	onDisable: () => void;
	onRefresh: () => void;
	busy: boolean;
	disabled: boolean;
}) {
	const dotClass = mode === "on"
		? "bg-emerald-400"
		: mode === "off"
			? "bg-ink-faint"
			: "bg-amber-400";
	const label = mode === "on" ? "On" : mode === "off" ? "Off" : "Unknown";
	const controlsDisabled = disabled || busy;

	return (
		<div className="rounded-lg border border-app-line/60 bg-app-box/40 px-3 py-2 backdrop-blur-sm">
			<div className="flex flex-wrap items-center gap-2 text-tiny">
				<div className="flex items-center gap-1.5 text-ink-dull">
					<div className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
					<span>Override: {label}</span>
				</div>
				<div className="ml-auto flex items-center gap-1.5">
					<button
						type="button"
						onClick={onRefresh}
						disabled={controlsDisabled}
						className="rounded border border-app-line/70 px-2 py-1 text-ink-faint transition-colors hover:bg-app-hover disabled:opacity-40"
					>
						Check
					</button>
					<button
						type="button"
						onClick={onEnable}
						disabled={controlsDisabled}
						className={`rounded border px-2 py-1 transition-colors disabled:opacity-40 ${
							mode === "on"
								? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
								: "border-app-line/70 text-ink-faint hover:bg-app-hover"
						}`}
					>
						On
					</button>
					<button
						type="button"
						onClick={onDisable}
						disabled={controlsDisabled}
						className={`rounded border px-2 py-1 transition-colors disabled:opacity-40 ${
							mode === "off"
								? "border-ink-faint/60 bg-app-hover text-ink"
								: "border-app-line/70 text-ink-faint hover:bg-app-hover"
						}`}
					>
						Off
					</button>
				</div>
			</div>
		</div>
	);
}

function FloatingChatInput({
	value,
	onChange,
	onSubmit,
	disabled,
	agentId,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	disabled: boolean;
	agentId: string;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		const adjustHeight = () => {
			textarea.style.height = "auto";
			const scrollHeight = textarea.scrollHeight;
			const maxHeight = 200;
			textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
			textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
		};

		adjustHeight();
		textarea.addEventListener("input", adjustHeight);
		return () => textarea.removeEventListener("input", adjustHeight);
	}, [value]);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			onSubmit();
		}
	};

	return (
		<div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4 pt-8 bg-gradient-to-t from-app via-app/80 to-transparent pointer-events-none">
			<div className="w-full max-w-2xl pointer-events-auto">
				<div className="rounded-2xl border border-app-line/50 bg-app-box/40 backdrop-blur-xl shadow-xl transition-colors duration-200 hover:border-app-line/70">
					<div className="flex items-end gap-2 p-3">
						<textarea
							ref={textareaRef}
							value={value}
							onChange={(event) => onChange(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={disabled ? "Waiting for response..." : `Message ${agentId}...`}
							disabled={disabled}
							rows={1}
							className="flex-1 resize-none bg-transparent px-1 py-1.5 text-base md:text-sm text-ink placeholder:text-ink-faint/60 focus:outline-none disabled:opacity-40"
							style={{maxHeight: "200px"}}
						/>
						<button
							type="button"
							onClick={onSubmit}
							disabled={disabled || !value.trim()}
							className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-all duration-150 hover:bg-accent-deep disabled:opacity-30 disabled:hover:bg-accent"
						>
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<path d="M12 19V5M5 12l7-7 7 7" />
							</svg>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function tryParseJson(text: string): Record<string, unknown> | null {
	if (!text || text.trim().length === 0) return null;
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

function detectOverrideModeFromTimeline(timeline: TimelineItem[]): OverrideMode {
	for (let index = timeline.length - 1; index >= 0; index -= 1) {
		const item = timeline[index];
		if (item.type !== "message" || item.role !== "assistant") continue;
		const text = item.content.toLowerCase();
		if (text.includes("override mode: on") || text.includes("override mode enabled")) return "on";
		if (text.includes("override mode: off") || text.includes("override mode disabled")) return "off";
	}
	return "unknown";
}

export function WebChatPanel({agentId}: WebChatPanelProps) {
	const {sessionId, isSending, error, sendMessage} = useWebChat(agentId);
	const {liveStates} = useLiveContext();
	const [input, setInput] = useState("");
	const [overrideMode, setOverrideMode] = useState<OverrideMode>("unknown");
	const [overrideBusy, setOverrideBusy] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const liveState = liveStates[sessionId];
	const timeline = liveState?.timeline ?? [];
	const isTyping = liveState?.isTyping ?? false;
	const activeWorkers = Object.values(liveState?.workers ?? {});
	const execution = liveState?.channelExecution;
	const hasActiveWorkers = activeWorkers.length > 0;
	const inferredOverrideMode = useMemo(() => detectOverrideModeFromTimeline(timeline), [timeline]);

	useEffect(() => {
		if (inferredOverrideMode !== "unknown") {
			setOverrideMode(inferredOverrideMode);
		}
	}, [inferredOverrideMode]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({behavior: "smooth"});
	}, [timeline.length, isTyping, activeWorkers.length, execution?.calls.length, execution?.currentTool]);

	const handleSubmit = () => {
		const trimmed = input.trim();
		if (!trimmed || isSending) return;
		setInput("");
		sendMessage(trimmed);
	};

	const sendOverrideCommand = async (command: "/override status" | "/override on" | "/override off", optimistic?: OverrideMode) => {
		if (isSending || overrideBusy) return;
		if (optimistic) {
			setOverrideMode(optimistic);
		}
		setOverrideBusy(true);
		try {
			await sendMessage(command);
		} finally {
			setOverrideBusy(false);
		}
	};

	return (
		<div className="relative flex h-full w-full flex-col">
			<div className="flex-1 overflow-x-hidden overflow-y-auto">
				<div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-32">
					<div className="sticky top-0 z-10 flex flex-col gap-2 bg-app/90 pb-2 pt-2 backdrop-blur-sm">
						<OverrideControls
							mode={overrideMode}
							onEnable={() => {
								void sendOverrideCommand("/override on", "on");
							}}
							onDisable={() => {
								void sendOverrideCommand("/override off", "off");
							}}
							onRefresh={() => {
								void sendOverrideCommand("/override status");
							}}
							busy={overrideBusy}
							disabled={isSending || isTyping}
						/>
						{hasActiveWorkers && <ActiveWorkersPanel workers={activeWorkers} agentId={agentId} />}
						{execution && (execution.calls.length > 0 || execution.currentTool || isTyping) && (
							<ChannelExecutionPanel execution={execution} isTyping={isTyping} />
						)}
					</div>

					{timeline.length === 0 && !isTyping && (
						<div className="flex flex-col items-center justify-center py-24">
							<p className="text-sm text-ink-faint">Start a conversation with {agentId}</p>
						</div>
					)}

					{timeline.map((item) => {
						if (item.type === "branch_run") {
							return <BranchTimelineItem key={`branch-${item.id}`} item={item} />;
						}
						if (item.type === "worker_run") {
							return <WorkerTimelineItem key={`worker-${item.id}`} item={item} agentId={agentId} />;
						}
						return (
							<div key={item.id}>
								{item.role === "user" ? (
									<div className="flex justify-end">
										<div className="max-w-[85%] min-w-0 overflow-hidden rounded-2xl rounded-br-md bg-app-hover/30 px-4 py-2.5">
											<p className="text-sm text-ink break-all whitespace-pre-wrap">{item.content}</p>
										</div>
									</div>
								) : (
									<div className="text-sm text-ink-dull">
										<Markdown>{item.content}</Markdown>
									</div>
								)}
							</div>
						);
					})}

					{isTyping && !(execution && (execution.calls.length > 0 || execution.currentTool)) && <ThinkingIndicator />}

					{error && (
						<div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
							{error}
						</div>
					)}
					<div ref={messagesEndRef} />
				</div>
			</div>

			<FloatingChatInput
				value={input}
				onChange={setInput}
				onSubmit={handleSubmit}
				disabled={isSending || isTyping}
				agentId={agentId}
			/>
		</div>
	);
}
