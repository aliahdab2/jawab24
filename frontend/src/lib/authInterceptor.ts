import { AxiosInstance, AxiosError } from 'axios';

let isRefreshing = false;
let failedQueue: { resolve: (token: string | null) => void; reject: (err: any) => void }[] = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });

    failedQueue = [];
};

/**
 * Attaches the 401 Interceptor to the Axios instance
 * @param axiosInstance The axios instance to attach to (api)
 * @param refreshTokenFn The function to call to refresh the token
 */
export const setupAuthRefreshInterceptor = (
    axiosInstance: AxiosInstance,
    refreshTokenFn: () => Promise<any>
) => {
    axiosInstance.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const originalRequest = error.config as any;

            // Filter out login/refresh requests to avoid infinite loops
            if (!originalRequest || originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/refresh')) {
                return Promise.reject(error);
            }

            if (error.response?.status === 401 && !originalRequest._retry) {
                if (isRefreshing) {
                    return new Promise(function(resolve, reject) {
                        failedQueue.push({ resolve, reject });
                    })
                        .then(() => {
                            return axiosInstance(originalRequest);
                        })
                        .catch((err) => {
                            return Promise.reject(err);
                        });
                }

                originalRequest._retry = true;
                isRefreshing = true;

                try {
                    await refreshTokenFn();
                    processQueue(null);
                    return axiosInstance(originalRequest);
                } catch (err) {
                    processQueue(err, null);
                    // If refresh fails, let the caller handle it (usually redirects to login)
                    return Promise.reject(err);
                } finally {
                    isRefreshing = false;
                }
            }

            return Promise.reject(error);
        }
    );
};
