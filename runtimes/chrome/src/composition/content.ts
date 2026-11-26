import { answerWorker, checkWithWorker } from "../adapters/page-messages.ts";
import { productPage, watchProductPage } from "../adapters/product-page.ts";
import { PageWatch } from "../extension/page-watch.ts";
import { pageToast } from "../views/toast.ts";

const watch = new PageWatch(productPage, checkWithWorker, pageToast());
answerWorker(watch);
watchProductPage(watch.schedule);
watch.schedule();
