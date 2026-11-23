import { ACCESS, doorText } from "@/copy/credit";
import type { Door } from "@/domain/credit";
import { CheckIcon, CloseIcon } from "@/ui/icons";

/** Whether one kind of lender would take the client today, and why. */
export function DoorRow({ name, door }: { name: string; door: Door }) {
  const { reason, reopen } = doorText(door);
  return (
    <li className="door" data-access={door.access}>
      <div className="door-head">
        <i className="door-node" aria-hidden="true">
          {door.access === "open" ? <CheckIcon size={16} /> : door.access === "closed" ? <CloseIcon size={15} /> : <b />}
        </i>
        <div>
          <h3 className="door-name">
            {name}
            <span className="door-state">{ACCESS[door.access]}</span>
          </h3>
          <p className="door-say">
            {reason}
            {reopen && ` ${reopen}`}
          </p>
        </div>
      </div>
    </li>
  );
}
