import { answerWorker, pageWorker } from "../adapters/page-messages.ts";
import { followPageLifecycle, productPage, watchProductPage } from "../adapters/product-page.ts";
import { PageWatch } from "../extension/page-watch.ts";
import { pageToast } from "../views/toast.ts";

const watch = new PageWatch(productPage, pageWorker, pageToast(), watchProductPage);
answerWorker(watch);
// The page stays unread until the worker confirms consent; each later change makes it ask again.
void watch.refresh();
// A page restored from the back-forward cache missed any change while it was away, so it asks again too.
followPageLifecycle(watch.suspend, () => void watch.refresh());
