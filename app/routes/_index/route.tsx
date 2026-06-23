import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <main className={styles.index}>
      <section className={styles.content}>
        <p className={styles.eyebrow}>Lens Search</p>
        <h1 className={styles.heading}>AI image search for Shopify storefronts</h1>
        <p className={styles.text}>
          Upload an image, find matching products, and save favorites from a
          Shopify storefront experience.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="example.myshopify.com"
              />
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>Image-based product discovery</li>
          <li>Storefront favorites and upload history</li>
          <li>Background product indexing from Shopify webhooks</li>
        </ul>
      </section>
    </main>
  );
}
