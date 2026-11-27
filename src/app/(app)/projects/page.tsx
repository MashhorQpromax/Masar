import { redirect } from "next/navigation";

/** Projects are listed among the office's files. */
export default function ProjectsPage(): never {
  redirect("/clients");
}
